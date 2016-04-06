module powerbi.visuals {
    import Color = jsCommon.Color;
    import PixelConverter = jsCommon.PixelConverter;
    import Polygon = shapes.Polygon;
    import DataRoleHelper = powerbi.data.DataRoleHelper;


    /** 
     * Used because data points used in D3 pie layouts are placed within a container with pie information.
     */
    interface MapSliceContainer {
        data: MapSlice;
    }

    export interface PolygonMapData {
        dataPoints: PolygonMapDataPoint[][];
    }

    export interface MapPolygonPoint extends TooltipEnabledDataPoint, SelectableDataPoint {
        x: number;
        y: number;
        fill?: string;
        stroke?: string;
        strokeWidth?: number;
    }

    export interface PolygonMapRendererData {
        polygonData: MapPolygonPoint[][];
    }

    export interface IPolygonMapDataPointRenderer {
        init(mapControl: Microsoft.Maps.Map, mapDiv: JQuery, addClearCatcher: boolean): void;
        setData(data: PolygonMapData): void;
        getDataPointCount(): number;
        converter(viewPort: IViewport, dataView: DataView): PolygonMapRendererData;
        clear(): void;
        updateInternal(data: PolygonMapRendererData, viewport: IViewport, dataChanged: boolean, interactivityService: IInteractivityService, redrawDataLabels: boolean): void;
        getDataPointPadding(): number;
        clearDataPoints(): void;
    }

    export interface PolygonMapDataPoint {
        location?: IGeocodeCoordinate;
    }

    export class MapPolygonDataPointRenderer implements IPolygonMapDataPointRenderer {
        private mapControl: Microsoft.Maps.Map;
        private mapData: PolygonMapData;
        private maxDataPointRadius: number;
        private svg: D3.Selection;
        private clearSvg: D3.Selection;
        private clearCatcher: D3.Selection;
        private polygonsGraphicsContext: D3.Selection;
        private dataLabelsSettings: PointDataLabelsSettings;
        private tooltipsEnabled: boolean;
        private static validLabelPositions: NewPointLabelPosition[] = [NewPointLabelPosition.Above, NewPointLabelPosition.Below, NewPointLabelPosition.Left, NewPointLabelPosition.Right];
        private mapRendererData: PolygonMapRendererData;
        private root: JQuery;

        public constructor(tooltipsEnabled: boolean) {
            this.tooltipsEnabled = tooltipsEnabled;
        }

        public init(mapControl: Microsoft.Maps.Map, mapDiv: JQuery, addClearCatcher: boolean): void {
            /*
                The layout of the visual would look like :
                <div class="visual mapControl">
                    <div class="MicrosoftMap">
                        <!-- Bing maps stuff -->
                        <svg>
                            <rect class="clearCatcher"></rect>
                        </svg>
                    </div>
                    <svg>
                        <g class="mapBubbles>
                            <!-- our geometry -->
                        </g>
                        <g class="mapSlices>
                            <!-- our geometry -->
                        </g>
                    </svg>
                </div>                    

            */

            this.mapControl = mapControl;
            this.root = mapDiv;
            let root = d3.select(mapDiv[0]);
            root.attr("drag-resize-disabled", "true"); // Enable panning within the maps in IE
            let svg = this.svg = root
                .append('svg')
                .style("position", "absolute") // Absolute position so that the svg will overlap with the canvas.
                .style("pointer-events", "none");
            if (addClearCatcher) {
                let clearSvg = this.clearSvg = d3.select(<HTMLElement>this.mapControl.getRootElement())
                    .append('svg')
                    .style('position', 'absolute'); // Absolute position so that the svg will overlap with the canvas.
                this.clearCatcher = appendClearCatcher(clearSvg);
            }
            this.polygonsGraphicsContext = svg
                .append("g")
                .classed("mapPolygons", true);

            this.clearMaxDataPointRadius();
            this.dataLabelsSettings = dataLabelUtils.getDefaultMapLabelSettings();
        }

        public setData(data: PolygonMapData): void {
            this.mapData = data;
        }

        public clearDataPoints(): void {
            this.mapData = {
                dataPoints: [],
                geocodingCategory: null,
                hasDynamicSeries: false,
            };
        }

        public getDataPointCount(): number {
            if (!this.mapData)
                return 0;
            // Filter out any data points without a location since those aren't actually being drawn
            let i = 0;
            _.filter(this.mapData.dataPoints, (value: MapDataPoint[]) => _.filter(value, (innerValue: MapDataPoint) => i++/*!!innerValue.location).length*/));
            return i;
        }

        public getDataPointPadding(): number {
            return this.maxDataPointRadius * 2;
        }

        private clearMaxDataPointRadius(): void {
            this.maxDataPointRadius = 0;
        }

        private setMaxDataPointRadius(dataPointRadius: number): void {
            this.maxDataPointRadius = Math.max(dataPointRadius, this.maxDataPointRadius);
        }

        public getDefaultMap(geocodingCategory: string, dataPointCount: number): void {
            this.clearDataPoints();
        }

        public converter(viewport: IViewport, dataView: DataView): PolygonMapRendererData {
            let start = Date.now();

            let mapControl = this.mapControl;
            let widthOverTwo = viewport.width / 2;
            let heightOverTwo = viewport.height / 2;

            this.clearMaxDataPointRadius();

            let polygonData: MapPolygonPoint[][] = [];

            let polygonDataPoints = this.mapData ? this.mapData.dataPoints : [];
            for (let dataPoints of polygonDataPoints) {
                let singlePolygonData: MapPolygonPoint[] = [];
                for (let index = 0, count = dataPoints.length; index < count; index++) {
                    let location = dataPoints[index].location;

                    let xy = mapControl.tryLocationToPixel(new Microsoft.Maps.Location(location.latitude, location.longitude));
                    let x = xy.x + widthOverTwo;
                    let y = xy.y + heightOverTwo;

                    singlePolygonData.push({
                        x: x,
                        y: y,
                        identity: null,
                        selected: false,
                    });
                }
                polygonData.push(singlePolygonData);
            }

            let end = Date.now() - start;
            console.log("End MapPolygonDataPointRenderer converter: " + end + "millisecs");

            return { polygonData: polygonData };
        }


        public clear(): void {
            this.polygonsGraphicsContext.selectAll(".polygon").remove();
        }

        public updateInternal(data: PolygonMapRendererData, viewport: IViewport, dataChanged: boolean, interactivityService: IInteractivityService, redrawDataLabels: boolean): void {
            let start = Date.now();
            //PolygonMap.removeTransform3d(this.root);

            if (this.svg) {
                this.svg
                    .style("width", viewport.width.toString() + "px")
                    .style("height", viewport.height.toString() + "px");
            }
            if (this.clearSvg) {
                this.clearSvg
                    .style("width", viewport.width.toString() + "px")
                    .style("height", viewport.height.toString() + "px");
            }

            var lineFunction = d3.svg.line()
                .x(function (d) { return d.x; })
                .y(function (d) { return d.y; })
                .interpolate("linear");

            if (data.polygonData && data.polygonData.length > 0)
                for (let index = 0, maxIndex = data.polygonData.length; index < maxIndex; index++) {
                    let polygon = this.polygonsGraphicsContext.append("path")
                        .classed("polygon", true)
                        .data([data.polygonData[index]]);
                    polygon.attr('d', (d: MapBubble[]) => lineFunction(d));

                    //if (this.tooltipsEnabled) {
                    //    TooltipManager.addTooltip(lines, (tooltipEvent: TooltipEvent) => tooltipEvent.data.tooltipInfo);
                    //    lines.style("pointer-events", "all");
                    //}
                }

            //if (this.tooltipsEnabled) {
            //    TooltipManager.addTooltip(slices, (tooltipEvent: TooltipEvent) => tooltipEvent.data.data.tooltipInfo);
            //    slices.style("pointer-events", "all");
            //}

            //let allData: SelectableDataPoint[] = data.bubbleData.slice();

            let end = Date.now() - start;
            console.log("End MapPolygonDataPointRenderer updateInternal: " + end + " millisecs");
        }

    }

    export class PolygonMap implements IVisual {
        public currentViewport: IViewport;

        private pendingGeocodingRender: boolean;
        private mapControl: Microsoft.Maps.Map;
        private minLongitude: number;
        private maxLongitude: number;
        private minLatitude: number;
        private maxLatitude: number;
        private style: IVisualStyle;
        private colors: IDataColorPalette;
        private dataPointRenderer: IPolygonMapDataPointRenderer;
        private geocodingCategory: string;
        private legend: ILegend;
        private legendHeight;
        private legendData: LegendData;
        private element: JQuery;
        private dataView: DataView;
        private dataLabelsSettings: PointDataLabelsSettings;
        private static MapContainer = {
            cssClass: 'mapControl',
            selector: '.mapControl'
        };
        public static StrokeDarkenColorValue = 255 * 0.25;
        private interactivityService: IInteractivityService;
        private behavior: MapBehavior;
        private defaultDataPointColor: string;
        private showAllDataPoints: boolean;
        private dataPointsToEnumerate: LegendDataPoint[];
        private hasDynamicSeries: boolean;
        private geoTaggingAnalyzerService: powerbi.IGeoTaggingAnalyzerService;
        private host: IVisualHostServices;
        //private receivedExternalViewChange = false;
        private executingInternalViewChange = true;
        private geocoder: IGeocoder;
        private mapControlFactory: IMapControlFactory;
        private tooltipsEnabled: boolean;
        private filledMapDataLabelsEnabled: boolean;
        private disableZooming: boolean;
        private disablePanning: boolean;
        private locale: string;
        private isLegendScrollable: boolean;
        private viewChangeThrottleInterval: number;
        private root: JQuery;

        constructor(options: MapConstructionOptions) {

            this.dataPointRenderer = new MapPolygonDataPointRenderer(options.tooltipsEnabled);

            this.mapControlFactory = options.mapControlFactory ? options.mapControlFactory : this.getDefaultMapControlFactory();
            this.behavior = options.behavior;
            this.tooltipsEnabled = options.tooltipsEnabled;
            this.disableZooming = options.disableZooming;
            this.disablePanning = options.disablePanning;
            this.isLegendScrollable = !!options.behavior;
            this.viewChangeThrottleInterval = options.viewChangeThrottleInterval;
        }

        public init(options: VisualInitOptions) {
            let element = this.element = options.element;
            this.currentViewport = options.viewport;
            this.style = options.style;
            this.colors = this.style.colorPalette.dataColors;

            this.host = options.host;
            if (options.host.locale)
                this.locale = options.host.locale();
            this.geocoder = options.host.geocoder();

            this.resetBounds();

            this.mapControlFactory.ensureMap(this.locale, () => {
                Microsoft.Maps.loadModule('Microsoft.Maps.Overlays.Style', {
                    callback: () => {
                        this.initialize(element[0]);
                        this.updateInternal(true, true);
                        if (this.executingInternalViewChange) this.executingInternalViewChange = false;
                    }
                });

            });
        }

        private addDataPoint(dataPoint: PolygonMapDataPoint): void {
            let location = dataPoint.location;
            this.updateBounds(location.latitude, location.longitude);

            //this.scheduleRedraw();
        }

        private scheduleRedraw(): void {
            if (!this.pendingGeocodingRender && this.mapControl) {
                this.pendingGeocodingRender = true;
                // Maintain a 3 second delay between redraws from geocoded geometry
                setTimeout(() => {
                    this.updateInternal(true, true);
                    this.pendingGeocodingRender = false;
                }, 3000);
            }
        }

        private getOptimumLevelOfDetail(width: number, height: number): number {
            let dataPointCount = this.dataPointRenderer.getDataPointCount();
            if (dataPointCount === 0)
                return MapUtil.MinLevelOfDetail;

            let threshold: number = this.dataPointRenderer.getDataPointPadding();

            for (let levelOfDetail = MapUtil.MaxLevelOfDetail; levelOfDetail >= MapUtil.MinLevelOfDetail; levelOfDetail--) {
                let minXmaxY = MapUtil.latLongToPixelXY(this.minLatitude, this.minLongitude, levelOfDetail);
                let maxXminY = MapUtil.latLongToPixelXY(this.maxLatitude, this.maxLongitude, levelOfDetail);

                if (maxXminY.x - minXmaxY.x + threshold <= width && minXmaxY.y - maxXminY.y + threshold <= height) {
                    // if we have less than 2 data points we should not zoom in "too much"
                    if (dataPointCount < 2)
                        levelOfDetail = Math.min(MapUtil.MaxAutoZoomLevel, levelOfDetail);

                    return levelOfDetail;
                }
            }

            return MapUtil.MinLevelOfDetail;
        }

        private getViewCenter(levelOfDetail: number): Microsoft.Maps.Location {
            let minXmaxY = MapUtil.latLongToPixelXY(this.minLatitude, this.minLongitude, levelOfDetail);
            let maxXminY = MapUtil.latLongToPixelXY(this.maxLatitude, this.maxLongitude, levelOfDetail);
            return MapUtil.pixelXYToLocation((minXmaxY.x + maxXminY.x) / 2.0, (maxXminY.y + minXmaxY.y) / 2.0, levelOfDetail);
        }

        private resetBounds(): void {
            this.minLongitude = MapUtil.MaxAllowedLongitude;
            this.maxLongitude = MapUtil.MinAllowedLongitude;
            this.minLatitude = MapUtil.MaxAllowedLatitude;
            this.maxLatitude = MapUtil.MinAllowedLatitude;
        }

        private updateBounds(latitude: number, longitude: number): void {
            if (longitude < this.minLongitude) {
                this.minLongitude = longitude;
            }

            if (longitude > this.maxLongitude) {
                this.maxLongitude = longitude;
            }

            if (latitude < this.minLatitude) {
                this.minLatitude = latitude;
            }

            if (latitude > this.maxLatitude) {
                this.maxLatitude = latitude;
            }
        }

        public static legendObject(dataView: DataView): DataViewObject {
            return dataView &&
                dataView.metadata &&
                dataView.metadata.objects &&
                <DataViewObject>dataView.metadata.objects['legend'];
        }

        public static shouldEnumerateDataPoints(dataView: DataView, usesSizeForGradient: boolean): boolean {
            let hasSeries = DataRoleHelper.hasRoleInDataView(dataView, 'Series');
            let gradientRole = usesSizeForGradient ? 'Size' : 'Gradient';
            let hasGradientRole = DataRoleHelper.hasRoleInDataView(dataView, gradientRole);
            return hasSeries || !hasGradientRole;
        }

        public static shouldEnumerateCategoryLabels(filledMapDataLabelsEnabled: boolean): boolean {
            return (filledMapDataLabelsEnabled);
        }

        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
            let enumeration = new ObjectEnumerationBuilder();
            switch (options.objectName) {
                case 'dataPoint':
                    if (PolygonMap.shouldEnumerateDataPoints(this.dataView, false)) {
                        let polygonData: MapPolygonPoint[][] = [];
                        //TODO: better way of getting this data
                        let hasDynamicSeries = this.hasDynamicSeries;
                        if (!hasDynamicSeries) {
                            let mapData = this.dataPointRenderer.converter(this.getMapViewPort(), this.dataView);
                            polygonData = mapData.polygonData;
                        }
                        PolygonMap.enumerateDataPoints(enumeration, this.dataPointsToEnumerate, this.colors, hasDynamicSeries, this.defaultDataPointColor, this.showAllDataPoints, polygonData);
                    }
                    break;
                case 'categoryLabels':
                    if (PolygonMap.shouldEnumerateCategoryLabels(this.filledMapDataLabelsEnabled)) {
                        dataLabelUtils.enumerateCategoryLabels(enumeration, this.dataLabelsSettings, true, true);
                    }
                    break;
                case 'legend':
                    if (this.hasDynamicSeries) {
                        //PolygonMap.enumerateLegend(enumeration, this.dataView, this.legend, this.legendTitle());
                    }
                    break;
                case 'labels':
                    if (this.filledMapDataLabelsEnabled) {
                        this.dataLabelsSettings = this.dataLabelsSettings ? this.dataLabelsSettings : dataLabelUtils.getDefaultMapLabelSettings();
                        let labelSettingOptions: VisualDataLabelsSettingsOptions = {
                            enumeration: enumeration,
                            dataLabelsSettings: this.dataLabelsSettings,
                            show: true,
                            displayUnits: true,
                            precision: true,
                        };
                        dataLabelUtils.enumerateDataLabels(labelSettingOptions);
                    }
                    break;
            }
            return enumeration.complete();
        }

        public static enumerateDataPoints(enumeration: ObjectEnumerationBuilder, dataPoints: LegendDataPoint[], colors: IDataColorPalette, hasDynamicSeries: boolean, defaultDataPointColor: string, showAllDataPoints: boolean, bubbleData: MapPolygonPoint[][]): void {
            let seriesLength = dataPoints && dataPoints.length;


            if (hasDynamicSeries) {
                for (let i = 0; i < seriesLength; i++) {

                    let dataPoint = dataPoints[i];
                    enumeration.pushInstance({
                        objectName: 'dataPoint',
                        displayName: dataPoint.label,
                        selector: dataPoint.identity.getSelector(),
                        properties: {
                            fill: { solid: { color: dataPoint.color } }
                        },
                    });
                }
            }
            else {
                enumeration.pushInstance({
                    objectName: 'dataPoint',
                    selector: null,
                    properties: {
                        defaultColor: { solid: { color: defaultDataPointColor || colors.getColorByIndex(0).value } }
                    },
                }).pushInstance({
                    objectName: 'dataPoint',
                    selector: null,
                    properties: {
                        showAllDataPoints: !!showAllDataPoints
                    },
                });

                if (bubbleData) {
                    for (let i = 0; i < bubbleData.length; i++) {
                        let bubbleDataPoint = bubbleData[i];
                        for (let singleBubbleDataPoint of bubbleDataPoint) {
                            enumeration.pushInstance({
                                objectName: 'dataPoint',
                                displayName: "",
                                selector: singleBubbleDataPoint.identity.getSelector(),
                                properties: {
                                    fill: { solid: { color: Color.normalizeToHexString(singleBubbleDataPoint.fill) } }
                                },
                            });
                        }
                    }
                }

            }
        }

        public onDataChanged(options: VisualDataChangedOptions): void {

            this.defaultDataPointColor = null;
            this.showAllDataPoints = null;
            let dataView = this.dataView = options.dataViews[0];
            let data: PolygonMapData = {
                dataPoints: [],
            };

            if (dataView) {
                // Convert data
                let colorHelper = new ColorHelper(this.colors, mapProps.dataPoint.fill, this.defaultDataPointColor);
                data = PolygonMap.converter(dataView, colorHelper);

                if (data != null) {
                    this.mapControlFactory.ensureMap(this.locale, () => {
                        let params;

                        for (let dataPointSet of data.dataPoints) {
                            for (let dataPoint of dataPointSet) {
                                this.addDataPoint(dataPoint);
                            }
                        }
                    });
                }
                else {
                    // No data from conversion, so clear data points
                    this.clearDataPoints();
                }

            }
            else {
                this.clearDataPoints();
                this.dataPointsToEnumerate = [];
            }

            this.dataPointRenderer.setData(data);

            this.updateInternal(true /* dataChanged */, true /* redrawDataLabels */);
        }

        public static converter(dataView: DataView, colorHelper: ColorHelper): PolygonMapData {
            let start = Date.now();
            let dataPoints: PolygonMapDataPoint[][] = [];

            let features = dataView.categorical.categories[0].values[0].features;

            for (let feature of features) {
                let coordinates = feature.geometry.coordinates;
                for (let coordsContainer of coordinates) {
                    let coords = coordsContainer[0];

                    let singleDataPoints: PolygonMapDataPoint[] = [];
                    for (let i = 0, coordsLength = coords.length; i < coordsLength; i++) {
                        let coord = coords[i];

                        singleDataPoints.push({
                            location: { latitude: coord[1], longitude: coord[0] },
                        });

                    }
                    dataPoints.push(singleDataPoints);
                }
            }

            let mapData: PolygonMapData = {
                dataPoints: dataPoints,
            };

            let end = Date.now() - start;
            console.log("End PolygonMap converter: " + end + "millisecs");

            return mapData;
        }


        private swapLogoContainerChildElement() {
            // This is a workaround that allow maps to be printed from the IE and Edge browsers.
            // For some unknown reason, the presence of an <a> child element in the .LogoContainer
            // prevents dashboard map visuals from showing up when printed.
            // The trick is to swap out the <a> element with a <div> container.
            // There are no user impacts or visual changes.
            let logoContainer = this.element.find('.LogoContainer');

            if (logoContainer) {
                let aNode = logoContainer.find('a');
                if (aNode == null)
                    return;

                let divNode = $('<div>');
                aNode.children().clone().appendTo(divNode);
                aNode.remove();
                divNode.appendTo(logoContainer);
            }
        }

        public onResizing(viewport: IViewport): void {
            if (this.currentViewport.width !== viewport.width || this.currentViewport.height !== viewport.height) {
                this.currentViewport = viewport;
                this.updateInternal(false /* dataChanged */, false);
            }
        }

        private initialize(container: HTMLElement): void {
            let mapOptions = {
                credentials: MapUtil.Settings.BingKey,
                showMapTypeSelector: false,
                enableClickableLogo: false,
                enableSearchLogo: false,
                mapTypeId: Microsoft.Maps.MapTypeId.road,
                customizeOverlays: true,
                showDashboard: false,
                showScalebar: false,
                disableKeyboardInput: true, // Workaround for the BingMaps control moving focus from QnA
                disableZooming: this.disableZooming,
                disablePanning: this.disablePanning,
            };
            let divQuery = this.root = InJs.DomFactory.div().addClass(PolygonMap.MapContainer.cssClass).appendTo(container);
            this.mapControl = this.mapControlFactory.createMapControl(divQuery[0], mapOptions);

            if (this.viewChangeThrottleInterval !== undefined) {
                Microsoft.Maps.Events.addThrottledHandler(this.mapControl, 'viewchange', () => { this.onViewChanged(); },
                    this.viewChangeThrottleInterval);
            } else {
                Microsoft.Maps.Events.addHandler(this.mapControl, 'viewchange', () => { this.onViewChanged(); });
            }

            Microsoft.Maps.Events.addHandler(this.mapControl, "viewchangeend", () => { this.onViewChangeEnded(); });
            this.dataPointRenderer.init(this.mapControl, divQuery, !!this.behavior);

            if (!this.pendingGeocodingRender) {
                //this.updateInternal(true /* dataChanged */, true);
            }
        }

        private onViewChanged() {
            this.dataPointRenderer.clear();
        }

        private onViewChangeEnded() {
            this.updateOffsets(false, false /* dataChanged */);
            if (this.behavior)
                this.behavior.viewChanged();

            this.swapLogoContainerChildElement();

        }

        private getMapViewPort(): IViewport {
            let currentViewport = this.currentViewport;

            let mapViewport = {
                width: currentViewport.width,
                height: currentViewport.height,
            };

            return mapViewport;
        }

        public static removeTransform3d(mapRoot: JQuery): void {
            // don't remove transform3d from bing maps images in safari (using applewebkit engine)
            let userAgent = window.navigator.userAgent.toLowerCase();
            if (mapRoot && userAgent.indexOf('applewebkit') === -1) {
                let imageTiles = mapRoot.find('img');
                imageTiles.css('transform', '');
            }
        }

        private updateInternal(dataChanged: boolean, redrawDataLabels: boolean) {
            if (this.mapControl) {

                let mapDiv = this.element.children(PolygonMap.MapContainer.selector);
                let mapViewport = this.getMapViewPort();
                mapDiv.height(mapViewport.height);
                mapDiv.width(mapViewport.width);


                // Set zoom level after we rendered that map as we need the max size of the bubbles/ pie slices to calculate it
                let levelOfDetail = this.getOptimumLevelOfDetail(mapViewport.width, mapViewport.height);
                let center = this.getViewCenter(levelOfDetail);

                if (!this.interactivityService) {
                    //this.executingInternalViewChange = true;
                    this.mapControl.setView({ center: center, zoom: levelOfDetail, animate: true });
                }

                // With the risk of double drawing, if the position updates to nearly the same, the map control won't call viewchange, so explicitly update the points
                //this.updateOffsets(dataChanged, redrawDataLabels);
            }
        }

        private updateOffsets(dataChanged: boolean, redrawDataLabels: boolean) {
            let dataView = this.dataView;
            let data: PolygonMapRendererData;
            let viewport = this.getMapViewPort();
            if (dataView && dataView.categorical) {
                this.dataPointRenderer.clear();
                data = this.dataPointRenderer.converter(viewport, this.dataView);
            }
            else {
                data = {
                    polygonData: []
                };
            }

            this.dataPointRenderer.updateInternal(data, viewport, dataChanged, this.interactivityService, redrawDataLabels);
        }

        public onClearSelection(): void {
            this.interactivityService.clearSelection();
            this.updateOffsets(false, false /* dataChanged */);
        }

        private clearDataPoints(): void {
            this.dataPointRenderer.clearDataPoints();
        }

        private getDefaultMapControlFactory(): IMapControlFactory {
            return {
                createMapControl: (element: HTMLElement, options: Microsoft.Maps.MapOptions) => new Microsoft.Maps.Map(element, options),
                ensureMap: jsCommon.ensureMap,
            };
        }
    }
}