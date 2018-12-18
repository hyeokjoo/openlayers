/**
 * @module ol/renderer/Map
 */
import {includes} from '../array.js';
import {abstract, getUid} from '../util.js';
import Disposable from '../Disposable.js';
import {listen, unlistenByKey} from '../events.js';
import EventType from '../events/EventType.js';
import {getWidth} from '../extent.js';
import {TRUE} from '../functions.js';
import {visibleAtResolution} from '../layer/Layer.js';
import {shared as iconImageCache} from '../style/IconImageCache.js';
import {compose as composeTransform, makeInverse} from '../transform.js';

/**
 * @abstract
 */
class MapRenderer extends Disposable {

  /**
   * @param {import("../PluggableMap.js").default} map Map.
   */
  constructor(map) {
    super();

    /**
     * @private
     * @type {import("../PluggableMap.js").default}
     */
    this.map_ = map;

    /**
     * @private
     * @type {!Object<string, import("./Layer.js").default>}
     */
    this.layerRenderers_ = {};

    /**
     * @private
     * @type {Object<string, import("../events.js").EventsKey>}
     */
    this.layerRendererListeners_ = {};

  }

  /**
   * @abstract
   * @param {import("../render/EventType.js").default} type Event type.
   * @param {import("../PluggableMap.js").FrameState} frameState Frame state.
   */
  dispatchRenderEvent(type, frameState) {
    abstract();
  }

  /**
   * @param {import("../PluggableMap.js").FrameState} frameState FrameState.
   * @protected
   */
  calculateMatrices2D(frameState) {
    const viewState = frameState.viewState;
    const coordinateToPixelTransform = frameState.coordinateToPixelTransform;
    const pixelToCoordinateTransform = frameState.pixelToCoordinateTransform;

    composeTransform(coordinateToPixelTransform,
      frameState.size[0] / 2, frameState.size[1] / 2,
      1 / viewState.resolution, -1 / viewState.resolution,
      -viewState.rotation,
      -viewState.center[0], -viewState.center[1]);

    makeInverse(pixelToCoordinateTransform, coordinateToPixelTransform);
  }

  /**
   * Removes all layer renderers.
   */
  removeLayerRenderers() {
    for (const key in this.layerRenderers_) {
      this.removeLayerRendererByKey_(key).dispose();
    }
  }

  /**
   * @param {import("../coordinate.js").Coordinate} coordinate Coordinate.
   * @param {import("../PluggableMap.js").FrameState} frameState FrameState.
   * @param {number} hitTolerance Hit tolerance in pixels.
   * @param {function(this: S, import("../Feature.js").FeatureLike,
   *     import("../layer/Layer.js").default): T} callback Feature callback.
   * @param {S} thisArg Value to use as `this` when executing `callback`.
   * @param {function(this: U, import("../layer/Layer.js").default): boolean} layerFilter Layer filter
   *     function, only layers which are visible and for which this function
   *     returns `true` will be tested for features.  By default, all visible
   *     layers will be tested.
   * @param {U} thisArg2 Value to use as `this` when executing `layerFilter`.
   * @return {T|undefined} Callback result.
   * @template S,T,U
   */
  forEachFeatureAtCoordinate(
    coordinate,
    frameState,
    hitTolerance,
    callback,
    thisArg,
    layerFilter,
    thisArg2
  ) {
    let result;
    const viewState = frameState.viewState;
    const viewResolution = viewState.resolution;
    const managedLayers = frameState.layerStatesArray.map(function(state) {
      if (state.managed) {
        return getUid(state.layer);
      }
    });

    /**
     * @param {import("../Feature.js").FeatureLike} feature Feature.
     * @param {import("../layer/Layer.js").default} layer Layer.
     * @return {?} Callback result.
     */
    function forEachFeatureAtCoordinate(feature, layer) {
      const managed = includes(managedLayers, getUid(layer));
      if (!(getUid(feature) in frameState.skippedFeatureUids && !managed)) {
        return callback.call(thisArg, feature, managed ? layer : null);
      }
    }

    const projection = viewState.projection;

    let translatedCoordinate = coordinate;
    if (projection.canWrapX()) {
      const projectionExtent = projection.getExtent();
      const worldWidth = getWidth(projectionExtent);
      const x = coordinate[0];
      if (x < projectionExtent[0] || x > projectionExtent[2]) {
        const worldsAway = Math.ceil((projectionExtent[0] - x) / worldWidth);
        translatedCoordinate = [x + worldWidth * worldsAway, coordinate[1]];
      }
    }

    const layerStates = frameState.layerStatesArray;
    const numLayers = layerStates.length;
    let i;
    for (i = numLayers - 1; i >= 0; --i) {
      const layerState = layerStates[i];
      const layer = /** @type {import("../layer/Layer.js").default} */ (layerState.layer);
      if (visibleAtResolution(layerState, viewResolution) && layerFilter.call(thisArg2, layer)) {
        const layerRenderer = this.getLayerRenderer(layer);
        const source = layer.getSource();
        if (layerRenderer && source) {
          result = layerRenderer.forEachFeatureAtCoordinate(
            source.getWrapX() ? translatedCoordinate : coordinate,
            frameState, hitTolerance, forEachFeatureAtCoordinate);
        }
        if (result) {
          return result;
        }
      }
    }
    return undefined;
  }

  /**
   * @abstract
   * @param {import("../pixel.js").Pixel} pixel Pixel.
   * @param {import("../PluggableMap.js").FrameState} frameState FrameState.
   * @param {number} hitTolerance Hit tolerance in pixels.
   * @param {function(this: S, import("../layer/Layer.js").default, (Uint8ClampedArray|Uint8Array)): T} callback Layer
   *     callback.
   * @param {function(this: U, import("../layer/Layer.js").default): boolean} layerFilter Layer filter
   *     function, only layers which are visible and for which this function
   *     returns `true` will be tested for features.  By default, all visible
   *     layers will be tested.
   * @return {T|undefined} Callback result.
   * @template S,T,U
   */
  forEachLayerAtPixel(pixel, frameState, hitTolerance, callback, layerFilter) {
    return abstract();
  }

  /**
   * @param {import("../coordinate.js").Coordinate} coordinate Coordinate.
   * @param {import("../PluggableMap.js").FrameState} frameState FrameState.
   * @param {number} hitTolerance Hit tolerance in pixels.
   * @param {function(this: U, import("../layer/Layer.js").default): boolean} layerFilter Layer filter
   *     function, only layers which are visible and for which this function
   *     returns `true` will be tested for features.  By default, all visible
   *     layers will be tested.
   * @param {U} thisArg Value to use as `this` when executing `layerFilter`.
   * @return {boolean} Is there a feature at the given coordinate?
   * @template U
   */
  hasFeatureAtCoordinate(coordinate, frameState, hitTolerance, layerFilter, thisArg) {
    const hasFeature = this.forEachFeatureAtCoordinate(
      coordinate, frameState, hitTolerance, TRUE, this, layerFilter, thisArg);

    return hasFeature !== undefined;
  }

  /**
   * @param {import("../layer/Layer.js").default} layer Layer.
   * @protected
   * @return {import("./Layer.js").default} Layer renderer. May return null.
   */
  getLayerRenderer(layer) {
    const layerKey = getUid(layer);
    if (layerKey in this.layerRenderers_) {
      return this.layerRenderers_[layerKey];
    }

    const renderer = layer.getRenderer();
    if (!renderer) {
      return null;
    }

    this.layerRenderers_[layerKey] = renderer;
    this.layerRendererListeners_[layerKey] = listen(renderer, EventType.CHANGE, this.handleLayerRendererChange_, this);
    return renderer;
  }

  /**
   * @protected
   * @return {Object<string, import("./Layer.js").default>} Layer renderers.
   */
  getLayerRenderers() {
    return this.layerRenderers_;
  }

  /**
   * @return {import("../PluggableMap.js").default} Map.
   */
  getMap() {
    return this.map_;
  }

  /**
   * Handle changes in a layer renderer.
   * @private
   */
  handleLayerRendererChange_() {
    this.map_.render();
  }

  /**
   * @param {string} layerKey Layer key.
   * @return {import("./Layer.js").default} Layer renderer.
   * @private
   */
  removeLayerRendererByKey_(layerKey) {
    const layerRenderer = this.layerRenderers_[layerKey];
    delete this.layerRenderers_[layerKey];

    unlistenByKey(this.layerRendererListeners_[layerKey]);
    delete this.layerRendererListeners_[layerKey];

    return layerRenderer;
  }

  /**
   * @param {import("../PluggableMap.js").default} map Map.
   * @param {import("../PluggableMap.js").FrameState} frameState Frame state.
   * @private
   */
  removeUnusedLayerRenderers_(map, frameState) {
    const layersUids = getLayersUids(frameState.layerStatesArray);
    for (const layerKey in this.layerRenderers_) {
      if (!frameState || !(includes(layersUids, layerKey))) {
        this.removeLayerRendererByKey_(layerKey).dispose();
      }
    }
  }

  /**
   * Render.
   * @abstract
   * @param {?import("../PluggableMap.js").FrameState} frameState Frame state.
   */
  renderFrame(frameState) {
    abstract();
  }

  /**
   * @param {import("../PluggableMap.js").FrameState} frameState Frame state.
   * @protected
   */
  scheduleExpireIconCache(frameState) {
    frameState.postRenderFunctions.push(/** @type {import("../PluggableMap.js").PostRenderFunction} */ (expireIconCache));
  }

  /**
   * @param {!import("../PluggableMap.js").FrameState} frameState Frame state.
   * @protected
   */
  scheduleRemoveUnusedLayerRenderers(frameState) {
    const layersUids = getLayersUids(frameState.layerStatesArray);
    for (const layerKey in this.layerRenderers_) {
      if (!(includes(layersUids, layerKey))) {
        frameState.postRenderFunctions.push(
          /** @type {import("../PluggableMap.js").PostRenderFunction} */ (this.removeUnusedLayerRenderers_.bind(this))
        );
        return;
      }
    }
  }
}


/**
 * @param {import("../PluggableMap.js").default} map Map.
 * @param {import("../PluggableMap.js").FrameState} frameState Frame state.
 */
function expireIconCache(map, frameState) {
  iconImageCache.expire();
}

/**
 * @param {Array<import("../layer/Layer.js").State>} layerStatesArray Layer states array.
 * @return {Array<string>} Layers uid.
 */
function getLayersUids(layerStatesArray) {
  return layerStatesArray.map(function(state) {
    return getUid(state.layer);
  });
}

/**
 * @param {import("../layer/Layer.js").State} state1 First layer state.
 * @param {import("../layer/Layer.js").State} state2 Second layer state.
 * @return {number} The zIndex difference.
 */
export function sortByZIndex(state1, state2) {
  return state1.zIndex - state2.zIndex;
}
export default MapRenderer;
