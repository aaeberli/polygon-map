

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
        dataPoints: MapDataPoint[][];
        geocodingCategory: string;
        hasDynamicSeries: boolean;
    }

    export interface PolygonMapRendererData {
        bubbleData?: MapBubble[][];
        sliceData?: MapSlice[][];
        shapeData?: MapShape[];
    }

    export interface IPolygonMapDataPointRenderer {
        init(mapControl: Microsoft.Maps.Map, mapDiv: JQuery, addClearCatcher: boolean): void;
        setData(data: PolygonMapData): void;
        getDataPointCount(): number;
        converter(viewPort: IViewport, dataView: DataView, labelSettings: PointDataLabelsSettings, interactivityService: IInteractivityService, tooltipsEnabled: boolean): PolygonMapRendererData;
        updateInternal(data: PolygonMapRendererData, viewport: IViewport, dataChanged: boolean, interactivityService: IInteractivityService, redrawDataLabels: boolean): MapBehaviorOptions;
        updateInternalDataLabels(viewport: IViewport, redrawDataLabels: boolean): void;
        getDataPointPadding(): number;
        clearDataPoints(): void;
    }

    export class MapPolygonDataPointRenderer implements IPolygonMapDataPointRenderer {
        private mapControl: Microsoft.Maps.Map;
        private mapData: PolygonMapData;
        private maxDataPointRadius: number;
        private svg: D3.Selection;
        private clearSvg: D3.Selection;
        private clearCatcher: D3.Selection;
        private bubbleGraphicsContext: D3.Selection;
        private sliceGraphicsContext: D3.Selection;
        private labelGraphicsContext: D3.Selection;
        private labelBackgroundGraphicsContext: D3.Selection;
        private sliceLayout: D3.Layout.PieLayout;
        private arc: D3.Svg.Arc;
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
            this.bubbleGraphicsContext = svg
                .append("g")
                .classed("mapBubbles", true);
            this.sliceGraphicsContext = svg
                .append("g")
                .classed("mapSlices", true);
            this.labelBackgroundGraphicsContext = svg
                .append("g")
                .classed(NewDataLabelUtils.labelBackgroundGraphicsContextClass.class, true);
            this.labelGraphicsContext = svg
                .append("g")
                .classed(NewDataLabelUtils.labelGraphicsContextClass.class, true);
            this.sliceLayout = d3.layout.pie()
                .sort(null)
                .value((d: MapSlice) => {
                    return d.value;
                });
            this.arc = d3.svg.arc();
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

        public converter(viewport: IViewport, dataView: DataView, labelSettings: PointDataLabelsSettings, interactivityService: IInteractivityService, tooltipsEnabled: boolean = true): PolygonMapRendererData {
            let mapControl = this.mapControl;
            let widthOverTwo = viewport.width / 2;
            let heightOverTwo = viewport.height / 2;

            let strokeWidth = 1;

            //update data label settings
            this.dataLabelsSettings = labelSettings;

            // See MapSeriesPresenter::GetDataPointRadius for the PV behavior
            let radiusScale = Math.min(viewport.width, viewport.height) / 384;
            this.clearMaxDataPointRadius();

            let bubbleData: MapBubble[][] = [];
            let sliceData: MapSlice[][] = [];
            let categorical: DataViewCategorical = dataView ? dataView.categorical : null;

            let grouped: DataViewValueColumnGroup[];
            let sizeIndex = -1;
            let dataValuesSource: DataViewMetadataColumn;
            if (categorical && categorical.values) {
                grouped = categorical.values.grouped();
                sizeIndex = DataRoleHelper.getMeasureIndexOfRole(grouped, "Size");
                dataValuesSource = categorical.values.source;
            }

            let polygonDataPoints = this.mapData ? this.mapData.dataPoints : [];
            for (let dataPoints of polygonDataPoints) {
                let singleBubbleData: MapBubble[] = [];
                for (let categoryIndex = 0, categoryCount = dataPoints.length; categoryIndex < categoryCount; categoryIndex++) {
                    let dataPoint = dataPoints[categoryIndex];
                    let categoryValue = dataPoint.categoryValue;
                    let location = dataPoint.location;

                    if (location) {
                        let xy = mapControl.tryLocationToPixel(new Microsoft.Maps.Location(location.latitude, location.longitude));
                        let x = xy.x + widthOverTwo;
                        let y = xy.y + heightOverTwo;

                        let radius = dataPoint.radius * radiusScale;
                        this.setMaxDataPointRadius(radius);
                        let subDataPoints = dataPoint.subDataPoints;

                        let seriesCount = subDataPoints.length;
                        if (seriesCount === 1) {
                            let subDataPoint: MapSubDataPoint = subDataPoints[0];

                            singleBubbleData.push({
                                x: x,
                                y: y,
                                labeltext: categoryValue,
                                radius: radius,
                                fill: subDataPoint.fill,
                                stroke: subDataPoint.stroke,
                                strokeWidth: strokeWidth,
                                tooltipInfo: subDataPoint.tooltipInfo,
                                identity: subDataPoint.identity,
                                selected: false,
                                labelFill: labelSettings.labelColor,
                            });
                        }
                        else throw new Error();
                    }
                }
                bubbleData.push(singleBubbleData);
            }

            if (interactivityService) {
                interactivityService.applySelectionStateToData(bubbleData[0]);
            }

            return { bubbleData: bubbleData, sliceData: sliceData };
        }

        public updateInternal(data: PolygonMapRendererData, viewport: IViewport, dataChanged: boolean, interactivityService: IInteractivityService, redrawDataLabels: boolean): MapBehaviorOptions {
            debug.assertValue(viewport, "viewport");
            PolygonMap.removeTransform3d(this.root);

            //this.mapRendererData = data;
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

            let arc = this.arc;

            let hasSelection = interactivityService && interactivityService.hasSelection();

            var lineFunction = d3.svg.line()
                .x(function (d) { return d.x; })
                .y(function (d) { return d.y; })
                .interpolate("linear");

            let index = 0;
            let liness = [];
            for (let singleBubbleData of data.bubbleData) {
                let lines = this.bubbleGraphicsContext.selectAll(".bubble" + index.toString()).data([singleBubbleData]);
                lines.enter()
                    .append("path")
                    .classed("bubble" + index.toString(), true);
                try {
                    lines
                        .style("stroke", (d: MapBubble[]) => "#000000"/*d[0].stroke*/)
                        .style("stroke-opacity", (d: MapBubble[]) => 1.0/*ColumnUtil.getFillOpacity(d[0].selected, false, hasSelection, false)*/)
                        .attr('d', (d: MapBubble[]) => lineFunction(d))
                        .style("fill", (d: MapBubble) => "#000000"/*d.fill*/)
                        .style("fill-opacity", (d: MapBubble[]) => 0.5)
                        .style("strokeWidth", (d: MapBubble[]) => 1/*d[0].strokeWidth*/)
                        .style("cursor", "default");
                    lines.exit().remove();
                }
                catch (ex)
                { }
                if (this.tooltipsEnabled) {
                    TooltipManager.addTooltip(lines, (tooltipEvent: TooltipEvent) => tooltipEvent.data.tooltipInfo);
                    lines.style("pointer-events", "all");
                }
                liness.push(lines);
                index++;

            }
            //let sliceData = data.sliceData;

            //let sliceContainers = this.sliceGraphicsContext.selectAll(".sliceContainer").data(sliceData);
            //sliceContainers.enter()
            //    .append("g")
            //    .classed("sliceContainer", true);

            //sliceContainers.exit().remove();

            //let sliceLayout = this.sliceLayout;
            //let slices = sliceContainers.selectAll(".slice")
            //    .data(function (d) {
            //        return sliceLayout(d);
            //    }, (d: MapSliceContainer) => d.data.identity.getKey());

            //slices.enter()
            //    .append("path")
            //    .classed("slice", true);

            //slices
            //    .style("fill", (t: MapSliceContainer) => t.data.fill)
            //    .style("fill-opacity", (d) => ColumnUtil.getFillOpacity(d.data.selected, false, hasSelection, false))
            //    .style("stroke", (t: MapSliceContainer) => t.data.stroke)
            //    .style("strokeWidth", (t: MapSliceContainer) => t.data.strokeWidth)
            //    .style("stroke-opacity", (d) => ColumnUtil.getFillOpacity(d.data.selected, false, hasSelection, false))
            //    .style("cursor", "default")
            //    .attr("transform", (t: MapSliceContainer) => SVGUtil.translate(t.data.x, t.data.y))
            //    .attr('d', (t: MapSliceContainer) => {
            //        return arc.innerRadius(0).outerRadius((t: MapSliceContainer) => t.data.radius)(t);
            //    });

            //slices.exit().remove();

            this.updateInternalDataLabels(viewport, redrawDataLabels);

            //if (this.tooltipsEnabled) {
            //    TooltipManager.addTooltip(slices, (tooltipEvent: TooltipEvent) => tooltipEvent.data.data.tooltipInfo);
            //    slices.style("pointer-events", "all");
            //}

            //let allData: SelectableDataPoint[] = data.bubbleData.slice();

            let behaviorOptions: MapBehaviorOptions = {
                bubbles: liness[0],
                clearCatcher: this.clearCatcher,
                dataPoints: null,// allData,
            };
            return behaviorOptions;
        }

        public updateInternalDataLabels(viewport: IViewport, redrawDataLabels: boolean): void {
            let labelSettings = this.dataLabelsSettings;
            let dataLabels: Label[] = [];
            if (labelSettings && (labelSettings.show || labelSettings.showCategory)) {
                let labelDataPoints = this.createLabelDataPoints();
                let labelLayout = new LabelLayout({
                    maximumOffset: NewDataLabelUtils.maxLabelOffset,
                    startingOffset: NewDataLabelUtils.startingLabelOffset
                });
                let labelDataPointsGroup: LabelDataPointsGroup = {
                    labelDataPoints: labelDataPoints,
                    maxNumberOfLabels: labelDataPoints.length
                };
                dataLabels = labelLayout.layout([labelDataPointsGroup], { width: viewport.width, height: viewport.height });
            }

            NewDataLabelUtils.drawLabelBackground(this.labelGraphicsContext, dataLabels, powerbi.visuals.DefaultBackgroundColor, powerbi.visuals.DefaultFillOpacity);
            NewDataLabelUtils.drawDefaultLabels(this.labelGraphicsContext, dataLabels, false); // Once we properly split up and handle show and showCategory, the false here should change to !labelSettings.showCategory
        }

        private createLabelDataPoints(): LabelDataPoint[] {
            let data = this.mapRendererData;
            let labelDataPoints: LabelDataPoint[] = [];
            let dataPoints = data.bubbleData;
            dataPoints = dataPoints.concat(_.map(data.sliceData, (value: MapSlice[]) => value[0]));
            let labelSettings = this.dataLabelsSettings;

            for (let singleDataPoints of dataPoints) {
                for (let dataPoint of singleDataPoints) {
                    debug.assertValue(dataPoint, 'dataPoint should never be null/undefined');
                    let text = dataPoint.labeltext;

                    let properties: TextProperties = {
                        text: text,
                        fontFamily: NewDataLabelUtils.LabelTextProperties.fontFamily,
                        fontSize: PixelConverter.fromPoint(labelSettings.fontSize),
                        fontWeight: NewDataLabelUtils.LabelTextProperties.fontWeight,
                    };
                    let textWidth = TextMeasurementService.measureSvgTextWidth(properties);
                    let textHeight = TextMeasurementService.estimateSvgTextHeight(properties);

                    labelDataPoints.push({
                        isPreferred: true,
                        text: text,
                        textSize: {
                            width: textWidth,
                            height: textHeight,
                        },
                        outsideFill: labelSettings.labelColor ? labelSettings.labelColor : NewDataLabelUtils.defaultInsideLabelColor, // Use inside for outside colors because we draw backgrounds for map labels
                        insideFill: NewDataLabelUtils.defaultInsideLabelColor,
                        parentType: LabelDataPointParentType.Point,
                        parentShape: {
                            point: {
                                x: dataPoint.x,
                                y: dataPoint.y,
                            },
                            radius: dataPoint.radius,
                            validPositions: MapPolygonDataPointRenderer.validLabelPositions,
                        },
                        fontSize: labelSettings.fontSize,
                        identity: undefined,
                        hasBackground: true,
                    });
                }
            }
            return labelDataPoints;
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
        private enableGeoShaping: boolean;
        private host: IVisualHostServices;
        private receivedExternalViewChange = false;
        private executingInternalViewChange = false;
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
            this.enableGeoShaping = false;

            this.mapControlFactory = options.mapControlFactory ? options.mapControlFactory : this.getDefaultMapControlFactory();
            this.behavior = options.behavior;
            this.tooltipsEnabled = options.tooltipsEnabled;
            this.disableZooming = options.disableZooming;
            this.disablePanning = options.disablePanning;
            this.isLegendScrollable = !!options.behavior;
            this.viewChangeThrottleInterval = options.viewChangeThrottleInterval;
        }

        public init(options: VisualInitOptions) {
            debug.assertValue(options, 'options');
            let element = this.element = options.element;
            this.pendingGeocodingRender = false;
            this.currentViewport = options.viewport;
            this.style = options.style;
            this.colors = this.style.colorPalette.dataColors;
            if (this.behavior)
                this.interactivityService = createInteractivityService(options.host);
            this.dataLabelsSettings = dataLabelUtils.getDefaultMapLabelSettings();
            this.legend = powerbi.visuals.createLegend(element, options.interactivity && options.interactivity.isInteractiveLegend, this.interactivityService, this.isLegendScrollable);
            this.legendHeight = 0;
            this.legendData = { dataPoints: [] };
            this.geoTaggingAnalyzerService = powerbi.createGeoTaggingAnalyzerService(options.host.getLocalizedString);
            this.host = options.host;
            if (options.host.locale)
                this.locale = options.host.locale();
            this.geocoder = options.host.geocoder();

            this.resetBounds();

            this.mapControlFactory.ensureMap(this.locale, () => {
                Microsoft.Maps.loadModule('Microsoft.Maps.Overlays.Style', {
                    callback: () => {
                        this.initialize(element[0]);
                    }
                });
            });
        }

        private addDataPoint(dataPoint: MapDataPoint): void {
            let location = dataPoint.location;
            this.updateBounds(location.latitude, location.longitude);

            this.scheduleRedraw();
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

        private enqueueGeoCode(dataPoint: MapDataPoint): void {
            this.geocoder.geocode(dataPoint.geocodingQuery, this.geocodingCategory).then((location) => {
                if (location) {
                    dataPoint.location = location;
                    this.addDataPoint(dataPoint);
                }
            });
        }

        private enqueueGeoCodeAndGeoShape(dataPoint: MapDataPoint, params: FilledMapParams): void {
            this.geocoder.geocode(dataPoint.geocodingQuery, this.geocodingCategory).then((location) => {
                if (location) {
                    dataPoint.location = location;
                    this.enqueueGeoShape(dataPoint, params);
                }
            });
        }

        private enqueueGeoShape(dataPoint: MapDataPoint, params: FilledMapParams): void {
            debug.assertValue(dataPoint.location, "cachedLocation");
            this.geocoder.geocodeBoundary(dataPoint.location.latitude, dataPoint.location.longitude, this.geocodingCategory, params.level, params.maxPolygons)
                .then((result: IGeocodeBoundaryCoordinate) => {
                    let paths;
                    if (result.locations.length === 0 || result.locations[0].geographic) {
                        paths = MapShapeDataPointRenderer.buildPaths(result.locations);
                    }
                    else {
                        MapUtil.calcGeoData(result);
                        paths = MapShapeDataPointRenderer.buildPaths(result.locations);
                    }
                    dataPoint.paths = paths;
                    this.addDataPoint(dataPoint);
                });
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

        public static isLegendHidden(dataView: DataView): boolean {
            let legendObject = PolygonMap.legendObject(dataView);
            return legendObject != null && legendObject[legendProps.show] === false;
        }

        public static legendPosition(dataView: DataView): LegendPosition {
            let legendObject = PolygonMap.legendObject(dataView);
            return legendObject && LegendPosition[<string>legendObject[legendProps.position]];
        }

        public static getLegendFontSize(dataView: DataView): number {
            let legendObject = PolygonMap.legendObject(dataView);
            return (legendObject && <number>legendObject[legendProps.fontSize]) || SVGLegend.DefaultFontSizeInPt;
        }

        public static isShowLegendTitle(dataView: DataView): boolean {
            let legendObject = PolygonMap.legendObject(dataView);
            return legendObject && <boolean>legendObject[legendProps.showTitle];
        }

        private legendTitle(): string {
            let legendObject = PolygonMap.legendObject(this.dataView);
            return (legendObject && <string>legendObject[legendProps.titleText]) || this.legendData.title;
        }

        private renderLegend(legendData: LegendData): void {
            let hideLegend = PolygonMap.isLegendHidden(this.dataView);
            let showTitle = PolygonMap.isShowLegendTitle(this.dataView);
            let title = this.legendTitle();
            // Update the legendData based on the hide flag.  Cartesian passes in no-datapoints. OnResize reuses the legendData, so this can't mutate.
            let clonedLegendData: LegendData = {
                dataPoints: hideLegend ? [] : legendData.dataPoints,
                grouped: legendData.grouped,
                title: showTitle ? title : "",
                fontSize: PolygonMap.getLegendFontSize(this.dataView)
            };

            // Update the orientation to match what's in the dataView
            let targetOrientation = PolygonMap.legendPosition(this.dataView);
            if (targetOrientation !== undefined) {
                this.legend.changeOrientation(targetOrientation);
            } else {
                this.legend.changeOrientation(LegendPosition.Top);
            }

            this.legend.drawLegend(clonedLegendData, this.currentViewport);
        }

        /** Note: public for UnitTest */
        public static calculateGroupSizes(categorical: DataViewCategorical, grouped: DataViewValueColumnGroup[], groupSizeTotals: number[], sizeMeasureIndex: number, currentValueScale: SimpleRange): SimpleRange {
            let categoryCount = categorical.values[0].values.length;
            let seriesCount = grouped.length;

            for (let i = 0, len = categoryCount; i < len; ++i) {
                let groupTotal = null;
                if (sizeMeasureIndex >= 0) {
                    for (let j = 0; j < seriesCount; ++j) {
                        let value = grouped[j].values[sizeMeasureIndex].values[i];
                        if (value) {
                            if (groupTotal === null) {
                                groupTotal = value;
                            } else {
                                groupTotal += value;
                            }
                        }
                    }
                }

                groupSizeTotals.push(groupTotal);

                if (groupTotal) {
                    if (!currentValueScale) {
                        currentValueScale = {
                            min: groupTotal,
                            max: groupTotal
                        };
                    } else {
                        currentValueScale.min = Math.min(currentValueScale.min, groupTotal);
                        currentValueScale.max = Math.max(currentValueScale.max, groupTotal);
                    }
                }
            }

            return currentValueScale;
        }

        /** Note: public for UnitTest */
        public static calculateRadius(range: SimpleRange, value?: number): number {
            let rangeDiff = range ? range.max - range.min : 0;
            let radius = 6;
            if (range != null && value != null && rangeDiff !== 0) {
                radius = (14 * ((value - range.min) / rangeDiff)) + 6;
            }

            return radius;
        }

        /** Note: public for UnitTest */
        public static getGeocodingCategory(categorical: DataViewCategorical, geoTaggingAnalyzerService: IGeoTaggingAnalyzerService): string {
            if (categorical && categorical.categories && categorical.categories.length > 0 && categorical.categories[0].source) {
                // Check categoryString for manually specified information in the model
                let type = <ValueType>categorical.categories[0].source.type;
                if (type && type.categoryString) {
                    return geoTaggingAnalyzerService.getFieldType(type.categoryString);
                }

                // Check the category name
                let categoryName = categorical.categories[0].source.displayName;
                let geotaggedResult = geoTaggingAnalyzerService.getFieldType(categoryName);
                if (geotaggedResult)
                    return geotaggedResult;

                // Checking roles for VRM backwards compatibility
                let roles = categorical.categories[0].source.roles;
                if (roles) {
                    let roleNames = Object.keys(roles);
                    for (let i = 0, len = roleNames.length; i < len; ++i) {
                        let typeFromRoleName = geoTaggingAnalyzerService.getFieldType(roleNames[i]);
                        if (typeFromRoleName)
                            return typeFromRoleName;
                    }
                }
            }

            return undefined;
        }

        /** Note: public for UnitTest */
        public static hasSizeField(values: DataViewValueColumns, defaultIndexIfNoRole?: number): boolean {
            if (_.isEmpty(values))
                return false;

            for (let i = 0, ilen = values.length; i < ilen; i++) {
                let roles = values[i].source.roles;

                // case for Power Q&A since Power Q&A does not assign role to measures.
                if (!roles && i === defaultIndexIfNoRole && values[i].source.type.numeric)
                    return true;

                if (roles) {
                    let roleNames = Object.keys(roles);
                    for (let j = 0, jlen = roleNames.length; j < jlen; j++) {
                        let role = roleNames[j];
                        if (role === "Size")
                            return true;
                    }
                }
            }
            return false;
        }

        public static shouldEnumerateDataPoints(dataView: DataView, usesSizeForGradient: boolean): boolean {
            let hasSeries = DataRoleHelper.hasRoleInDataView(dataView, 'Series');
            let gradientRole = usesSizeForGradient ? 'Size' : 'Gradient';
            let hasGradientRole = DataRoleHelper.hasRoleInDataView(dataView, gradientRole);
            return hasSeries || !hasGradientRole;
        }

        public static shouldEnumerateCategoryLabels(enableGeoShaping: boolean, filledMapDataLabelsEnabled: boolean): boolean {
            return (!enableGeoShaping || filledMapDataLabelsEnabled);
        }

        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
            let enumeration = new ObjectEnumerationBuilder();
            switch (options.objectName) {
                case 'dataPoint':
                    if (PolygonMap.shouldEnumerateDataPoints(this.dataView, this.enableGeoShaping)) {
                        let bubbleData: MapBubble[][] = [];
                        //TODO: better way of getting this data
                        let hasDynamicSeries = this.hasDynamicSeries;
                        if (!hasDynamicSeries) {
                            let mapData = this.dataPointRenderer.converter(this.getMapViewPort(), this.dataView, this.dataLabelsSettings, this.interactivityService, this.tooltipsEnabled);
                            bubbleData = mapData.bubbleData;
                        }
                        PolygonMap.enumerateDataPoints(enumeration, this.dataPointsToEnumerate, this.colors, hasDynamicSeries, this.defaultDataPointColor, this.showAllDataPoints, bubbleData);
                    }
                    break;
                case 'categoryLabels':
                    if (PolygonMap.shouldEnumerateCategoryLabels(this.enableGeoShaping, this.filledMapDataLabelsEnabled)) {
                        dataLabelUtils.enumerateCategoryLabels(enumeration, this.dataLabelsSettings, true, true);
                    }
                    break;
                case 'legend':
                    if (this.hasDynamicSeries) {
                        PolygonMap.enumerateLegend(enumeration, this.dataView, this.legend, this.legendTitle());
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

        public static enumerateDataPoints(enumeration: ObjectEnumerationBuilder, dataPoints: LegendDataPoint[], colors: IDataColorPalette, hasDynamicSeries: boolean, defaultDataPointColor: string, showAllDataPoints: boolean, bubbleData: MapBubble[][]): void {
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
                                displayName: singleBubbleDataPoint.labeltext,
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

        public static enumerateLegend(enumeration: ObjectEnumerationBuilder, dataView: DataView, legend: ILegend, legendTitle: string): void {
            enumeration.pushInstance({
                selector: null,
                properties: {
                    show: !PolygonMap.isLegendHidden(dataView),
                    position: LegendPosition[legend.getOrientation()],
                    showTitle: PolygonMap.isShowLegendTitle(dataView),
                    titleText: legendTitle,
                    fontSize: PolygonMap.getLegendFontSize(dataView)
                },
                objectName: 'legend'
            });
        }

        public onDataChanged(options: VisualDataChangedOptions): void {
            debug.assertValue(options, 'options');

            this.receivedExternalViewChange = false;

            this.dataLabelsSettings = dataLabelUtils.getDefaultMapLabelSettings();
            this.defaultDataPointColor = null;
            this.showAllDataPoints = null;
            let dataView = this.dataView = options.dataViews[0];
            let enableGeoShaping = this.enableGeoShaping;
            let warnings = [];
            let data: PolygonMapData = {
                dataPoints: [],
                geocodingCategory: null,
                hasDynamicSeries: false,
            };

            if (dataView) {
                // Handle object-based settings
                if (dataView.metadata && dataView.metadata.objects) {
                    let objects = dataView.metadata.objects;

                    this.defaultDataPointColor = DataViewObjects.getFillColor(objects, mapProps.dataPoint.defaultColor);
                    this.showAllDataPoints = DataViewObjects.getValue<boolean>(objects, mapProps.dataPoint.showAllDataPoints);

                    this.dataLabelsSettings.showCategory = DataViewObjects.getValue<boolean>(objects, filledMapProps.categoryLabels.show, this.dataLabelsSettings.showCategory);

                    if (enableGeoShaping) {
                        this.dataLabelsSettings.precision = DataViewObjects.getValue(objects, filledMapProps.labels.labelPrecision, this.dataLabelsSettings.precision);
                        this.dataLabelsSettings.precision = (this.dataLabelsSettings.precision !== dataLabelUtils.defaultLabelPrecision && this.dataLabelsSettings.precision < 0) ? 0 : this.dataLabelsSettings.precision;
                        this.dataLabelsSettings.displayUnits = DataViewObjects.getValue<number>(objects, filledMapProps.labels.labelDisplayUnits, this.dataLabelsSettings.displayUnits);
                        let datalabelsObj = objects['labels'];
                        if (datalabelsObj) {
                            this.dataLabelsSettings.show = (datalabelsObj['show'] !== undefined) ? <boolean>datalabelsObj['show'] : this.dataLabelsSettings.show;
                            if (datalabelsObj['color'] !== undefined) {
                                this.dataLabelsSettings.labelColor = (<Fill>datalabelsObj['color']).solid.color;
                            }
                        }
                    }
                    else {
                        let categoryLabelsObj = <DataLabelObject>objects['categoryLabels'];
                        if (categoryLabelsObj)
                            dataLabelUtils.updateLabelSettingsFromLabelsObject(categoryLabelsObj, this.dataLabelsSettings);
                    }
                }

                // Convert data
                let colorHelper = new ColorHelper(this.colors, mapProps.dataPoint.fill, this.defaultDataPointColor);
                data = PolygonMap.converter(dataView, colorHelper, this.geoTaggingAnalyzerService);
                this.hasDynamicSeries = data.hasDynamicSeries;

                // Create legend
                this.legendData = PolygonMap.createLegendData(dataView, colorHelper);
                this.dataPointsToEnumerate = this.legendData.dataPoints;
                this.renderLegend(this.legendData);

                // Start geocoding or geoshaping
                if (data != null) {
                    this.geocodingCategory = data.geocodingCategory;
                    this.mapControlFactory.ensureMap(this.locale, () => {
                        let params;
                        if (enableGeoShaping) {
                            params = MapShapeDataPointRenderer.getFilledMapParams(this.geocodingCategory, data.dataPoints.length);
                        }
                        for (let dataPointSet of data.dataPoints) {
                            for (let dataPoint of dataPointSet) {
                                if (!dataPoint.location) {
                                    if (!_.isEmpty(dataPoint.categoryValue)) { // If we don't have a location, but the category string is empty, skip geocoding so we don't geocode null/empty string
                                        if (enableGeoShaping)
                                            this.enqueueGeoCodeAndGeoShape(dataPoint, params);
                                        else
                                            this.enqueueGeoCode(dataPoint);
                                    }
                                }
                                else if (enableGeoShaping && !dataPoint.paths) {
                                    this.enqueueGeoShape(dataPoint, params);
                                }
                                else {
                                    this.addDataPoint(dataPoint);
                                }
                            }
                        }
                    });
                }
                else {
                    // No data from conversion, so clear data points
                    this.clearDataPoints();
                }

                if (enableGeoShaping) {
                    if (!this.geocodingCategory || !this.geoTaggingAnalyzerService.isGeoshapable(this.geocodingCategory)) {
                        warnings.push(new FilledMapWithoutValidGeotagCategoryWarning());
                    }
                }
            }
            else {
                this.clearDataPoints();
                this.renderLegend({
                    dataPoints: [],
                    title: undefined,
                });
                this.dataPointsToEnumerate = [];
            }

            if (!_.isEmpty(warnings))
                this.host.setWarnings(warnings);

            this.dataPointRenderer.setData(data);

            this.updateInternal(true /* dataChanged */, true /* redrawDataLabels */);
        }

        public static converter(dataView: DataView, colorHelper: ColorHelper, geoTaggingAnalyzerService: IGeoTaggingAnalyzerService): PolygonMapData {
            let reader = powerbi.data.createIDataViewCategoricalReader(dataView);
            let dataPoints: MapDataPoint[][] = [];
            let hasDynamicSeries = reader.hasDynamicSeries();
            let seriesColumnIdentifier = reader.getSeriesColumnIdentifier();
            let sizeQueryName = reader.getMeasureQueryName('Size');
            if (sizeQueryName == null)
                sizeQueryName = '';
            let hasSize = reader.hasValues('Size');
            let geocodingCategory = null;
            let formatStringProp = mapProps.general.formatString;

            if (reader.hasCategories()) {
                // Calculate category totals and range for radius calculation
                let categoryTotals: number[] = [];
                let categoryTotalRange;
                //if (hasSize) {
                //    let categoryMin: number = undefined;
                //    let categoryMax: number = undefined;
                //    for (let categoryIndex = 0, categoryCount = reader.getCategoryCount(); categoryIndex < categoryCount; categoryIndex++) {
                //        let categoryTotal = 0;
                //        for (let seriesIndex = 0, seriesCount = reader.getSeriesCount(); seriesIndex < seriesCount; seriesIndex++) {
                //            categoryTotal += reader.getValue('Size', categoryIndex, seriesIndex);
                //        }
                //        categoryTotals.push(categoryTotal);
                //        if (categoryMin === undefined || categoryTotal < categoryMin)
                //            categoryMin = categoryTotal;
                //        if (categoryMax === undefined || categoryTotal > categoryMax)
                //            categoryMax = categoryTotal;
                //    }
                //    categoryTotalRange = (categoryMin !== undefined && categoryMax !== undefined) ? {
                //        max: categoryMax,
                //        min: categoryMin,
                //    } : undefined;
                //}

                let hasLatLongGroup = true;//reader.hasCompositeCategories() && reader.hasCategoryWithRole('X') && reader.hasCategoryWithRole('Y');
                let hasCategoryGroup = reader.hasCategoryWithRole('Category');

                geocodingCategory = PolygonMap.getGeocodingCategory(dataView.categorical, geoTaggingAnalyzerService);

                if (hasLatLongGroup || hasCategoryGroup) {
                    // Create data points
                    //for (let categoryIndex = 0, categoryCount = reader.getCategoryCount(); categoryIndex < categoryCount; categoryIndex++) {
                    for (let feature of dataView.categorical.categories[0].values[0].features) {
                        //for (let kk = 0; kk < 1977; kk++) {
                        // Get category information
                        //let feature = dataView.categorical.categories[0].values[0].features[kk];

                        let categoryValue = undefined;

                        let categoryObjects = reader.getCategoryObjects(0, 'Category');
                        let location: IGeocodeCoordinate;
                        let categoryTooltipItem: TooltipDataItem;
                        let latitudeTooltipItem: TooltipDataItem;
                        let longitudeTooltipItem: TooltipDataItem;
                        let seriesTooltipItem: TooltipDataItem;
                        let sizeTooltipItem: TooltipDataItem;
                        let gradientTooltipItem: TooltipDataItem;

                        //let coords = dataView.categorical.categories[0].values[categoryIndex].split(";").slice(0, 50);
                        let coordsGroups = feature.geometry.coordinates;
                        for (let coordsGroup of coordsGroups) {

                            if (coordsGroup.length > 1) alert();

                            let coords = coordsGroup[0];

                            let singleDataPoints: MapDataPoint[] = [];
                            for (let i = 0; i < coords.length; i++) {
                                let latitude = coords[i][1];//coords[i].split(",")[1];
                                let longitude = coords[i][0];//coords[i].split(",")[0];

                                if (latitude != null && longitude != null) {
                                    // Combine latitude and longitude to create the category value
                                    categoryValue = latitude + ', ' + longitude;
                                    // Create location from latitude and longitude
                                    location = { latitude: latitude, longitude: longitude };
                                    //latitudeTooltipItem = {
                                    //    displayName: reader.getCategoryDisplayName('Y'),
                                    //    value: converterHelper.formatFromMetadataColumn(latitude, reader.getCategoryMetadataColumn('Y'), formatStringProp),
                                    //};
                                    //longitudeTooltipItem = {
                                    //    displayName: reader.getCategoryDisplayName('X'),
                                    //    value: converterHelper.formatFromMetadataColumn(longitude, reader.getCategoryMetadataColumn('X'), formatStringProp),
                                    //};
                                }

                                let value: number = hasSize ? categoryTotals[0] : undefined;
                    
                                // Calculate sub data points by series
                                let subDataPoints: MapSubDataPoint[] = [];
                                let seriesCount = reader.getSeriesCount();
                                if (!hasSize) {
                                    seriesCount = 1;
                                }
                                for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
                                    let color = hasDynamicSeries
                                        ? colorHelper.getColorForSeriesValue(reader.getSeriesObjects(seriesIndex), seriesColumnIdentifier, <string>(reader.getSeriesName(seriesIndex)))
                                        : colorHelper.getColorForMeasure(categoryObjects, sizeQueryName);

                                    let colorRgb = Color.parseColorString(color);
                                    let stroke = Color.hexString(Color.darken(colorRgb, PolygonMap.StrokeDarkenColorValue));
                                    colorRgb.A = 0.6;
                                    let fill = Color.rgbString(colorRgb);

                                    let identityBuilder = new SelectionIdBuilder()
                                        .withCategory(reader.getCategoryColumn(hasCategoryGroup ? 'Category' : 'Y'), 0)
                                        .withMeasure(sizeQueryName);
                                    if (hasDynamicSeries && hasSize) {
                                        identityBuilder = identityBuilder.withSeries(reader.getSeriesColumns(), reader.getValueColumn('Size', seriesIndex));
                                    }

                                    if (hasDynamicSeries) {
                                        seriesTooltipItem = {
                                            displayName: reader.getSeriesDisplayName(),
                                            value: converterHelper.formatFromMetadataColumn(reader.getSeriesName(seriesIndex), reader.getSeriesMetadataColumn(), formatStringProp),
                                        };
                                    }

                                    let subsliceValue: number;
                                    if (hasSize) {
                                        subsliceValue = reader.getValue('Size', 0, seriesIndex);
                                        sizeTooltipItem = {
                                            displayName: reader.getValueDisplayName('Size'),
                                            value: converterHelper.formatFromMetadataColumn(subsliceValue, reader.getValueMetadataColumn('Size', seriesIndex), formatStringProp),
                                        };
                                    }
                                    //if (reader.hasValues('Gradient')) {
                                    //    gradientTooltipItem = {
                                    //        displayName: reader.getValueDisplayName('Gradient'),
                                    //        value: converterHelper.formatFromMetadataColumn(reader.getValue('Gradient', categoryIndex, seriesIndex), reader.getValueMetadataColumn('Gradient', seriesIndex), formatStringProp),
                                    //    };
                                    //}
    
                                    // Combine any existing tooltip items
                                    let tooltipInfo: TooltipDataItem[] = [];
                                    //if (categoryTooltipItem)
                                    //    tooltipInfo.push(categoryTooltipItem);
                                    //if (seriesTooltipItem)
                                    //    tooltipInfo.push(seriesTooltipItem);
                                    //if (latitudeTooltipItem)
                                    //    tooltipInfo.push(latitudeTooltipItem);
                                    //if (longitudeTooltipItem)
                                    //    tooltipInfo.push(longitudeTooltipItem);
                                    //if (sizeTooltipItem)
                                    //    tooltipInfo.push(sizeTooltipItem);
                                    //if (gradientTooltipItem)
                                    //    tooltipInfo.push(gradientTooltipItem);
    
                                    // Do not create subslices for data points with 0 or null 
                                    if (subsliceValue || !hasSize) {
                                        subDataPoints.push({
                                            value: subsliceValue,
                                            fill: fill,
                                            stroke: stroke,
                                            identity: identityBuilder.createSelectionId(),
                                            tooltipInfo: tooltipInfo,
                                        });
                                    }
                                }

                                // Skip data points that have a total value of 0 or null
                                //if (value || !hasSize) {
                                singleDataPoints.push({
                                    geocodingQuery: categoryValue,
                                    value: value,
                                    categoryValue: categoryValue,
                                    subDataPoints: subDataPoints,
                                    radius: PolygonMap.calculateRadius(categoryTotalRange, value),
                                    location: location,
                                });
                                //}
                            }
                            dataPoints.push(singleDataPoints);
                        }
                    }
                }
            }

            let mapData: PolygonMapData = {
                dataPoints: dataPoints,
                geocodingCategory: geocodingCategory,
                hasDynamicSeries: hasDynamicSeries,
            };

            return mapData;
        }

        public static createLegendData(dataView: DataView, colorHelper: ColorHelper): LegendData {
            let reader = powerbi.data.createIDataViewCategoricalReader(dataView);
            let legendDataPoints: LegendDataPoint[] = [];
            let legendTitle: string;
            if (reader.hasDynamicSeries() && reader.hasValues('Size')) {
                legendTitle = reader.getSeriesDisplayName();
                let seriesColumnIdentifier = reader.getSeriesColumnIdentifier();
                for (let seriesIndex = 0, seriesCount = reader.getSeriesCount(); seriesIndex < seriesCount; seriesIndex++) {
                    let color = colorHelper.getColorForSeriesValue(reader.getSeriesObjects(seriesIndex), seriesColumnIdentifier, <string>reader.getSeriesName(seriesIndex));
                    let identity = new SelectionIdBuilder().withSeries(reader.getSeriesColumns(), reader.getValueColumn('Size', seriesIndex)).createSelectionId();
                    legendDataPoints.push({
                        color: color,
                        label: valueFormatter.format(reader.getSeriesName(seriesIndex)),
                        icon: LegendIcon.Circle,
                        identity: identity,
                        selected: false,
                    });
                }
            }
            let legendData: LegendData = {
                dataPoints: legendDataPoints,
                title: legendTitle,
            };
            return legendData;
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
                this.renderLegend(this.legendData);
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
                this.updateInternal(true /* dataChanged */, true);
            }
        }

        private onViewChanged() {
            if (!this.executingInternalViewChange)
                this.receivedExternalViewChange = true;
            else
                this.executingInternalViewChange = false;
            this.updateOffsets(false, false /* dataChanged */);
            if (this.behavior)
                this.behavior.viewChanged();

            this.swapLogoContainerChildElement();
        }

        private onViewChangeEnded() {

            this.dataPointRenderer.updateInternalDataLabels(this.currentViewport, true);
        }

        private getMapViewPort(): IViewport {
            let currentViewport = this.currentViewport;
            let legendMargins = this.legend.getMargins();

            let mapViewport = {
                width: currentViewport.width - legendMargins.width,
                height: currentViewport.height - legendMargins.height,
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
                let isLegendVisible = this.legend.isVisible();

                if (!isLegendVisible)
                    this.legendData = { dataPoints: [] };

                let mapDiv = this.element.children(PolygonMap.MapContainer.selector);
                let mapViewport = this.getMapViewPort();
                mapDiv.height(mapViewport.height);
                mapDiv.width(mapViewport.width);

                // With the risk of double drawing, if the position updates to nearly the same, the map control won't call viewchange, so explicitly update the points
                this.updateOffsets(dataChanged, redrawDataLabels);

                // Set zoom level after we rendered that map as we need the max size of the bubbles/ pie slices to calculate it
                let levelOfDetail = this.getOptimumLevelOfDetail(mapViewport.width, mapViewport.height);
                let center = this.getViewCenter(levelOfDetail);

                if (!this.receivedExternalViewChange || !this.interactivityService) {
                    this.executingInternalViewChange = true;
                    this.mapControl.setView({ center: center, zoom: levelOfDetail, animate: true });
                }
            }
        }

        private updateOffsets(dataChanged: boolean, redrawDataLabels: boolean) {
            let dataView = this.dataView;
            let data: PolygonMapRendererData;
            let viewport = this.getMapViewPort();
            if (dataView && dataView.categorical) {
                // currentViewport may not exist in UnitTests
                data = this.dataPointRenderer.converter(viewport, this.dataView, this.dataLabelsSettings, this.interactivityService, this.tooltipsEnabled);
            }
            else {
                data = {
                    bubbleData: [],
                    shapeData: [],
                    sliceData: [],
                };
            }

            let behaviorOptions = this.dataPointRenderer.updateInternal(data, viewport, dataChanged, this.interactivityService, redrawDataLabels);
            Legend.positionChartArea(d3.select(this.root[0]), this.legend);

            if (this.interactivityService && behaviorOptions) {
                this.interactivityService.bind(behaviorOptions.dataPoints, this.behavior, behaviorOptions);
            }
        }

        public onClearSelection(): void {
            this.interactivityService.clearSelection();
            this.updateOffsets(false, false /* dataChanged */);
        }

        private clearDataPoints(): void {
            this.dataPointRenderer.clearDataPoints();
            this.legend.drawLegend({ dataPoints: [] }, this.currentViewport);
        }

        private getDefaultMapControlFactory(): IMapControlFactory {
            return {
                createMapControl: (element: HTMLElement, options: Microsoft.Maps.MapOptions) => new Microsoft.Maps.Map(element, options),
                ensureMap: jsCommon.ensureMap,
            };
        }
    }
}