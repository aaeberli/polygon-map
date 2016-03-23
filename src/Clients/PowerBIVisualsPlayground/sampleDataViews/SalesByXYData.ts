/*
*  Power BI Visualizations
*
*  Copyright (c) Microsoft Corporation
*  All rights reserved. 
*  MIT License
*
*  Permission is hereby granted, free of charge, to any person obtaining a copy
*  of this software and associated documentation files (the ""Software""), to deal
*  in the Software without restriction, including without limitation the rights
*  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
*  copies of the Software, and to permit persons to whom the Software is
*  furnished to do so, subject to the following conditions:
*   
*  The above copyright notice and this permission notice shall be included in 
*  all copies or substantial portions of the Software.
*   
*  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
*  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
*  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE 
*  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
*  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
*  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
*  THE SOFTWARE.
*/

module powerbi.visuals.sampleDataViews {
    import DataViewTransform = powerbi.data.DataViewTransform;

    export class SalesByXYData extends SampleDataViews implements ISampleDataViewsMethods {

        public name: string = "SalesByXYData";
        public displayName: string = "Sales By Long & Lat";

        public visuals: string[] = ['polygonMap'];

        private sampleData = [
            [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],  // values
            [51.581484,51.577973,51.344887,51.374234,51.544385,51.622276,51.434173,51.649196,51.614012,51.375545],  // latitude
            [-0.436863, -0.451732, -0.130876, -0.371272, -0.136892, -0.095972, -0.186176, 0.045373, -0.034305, 0.097469]  // longitude
        ];

        private latitudeMin: number = 51.332073;
        private latitudeMax: number = 51.654266;

        private longitudeMin: number = -0.493542;
        private longitudeMax: number = 0.154846;


        public getDataViews(): DataView[] {

            var latitudeFieldExpr = powerbi.data.SQExprBuilder.fieldExpr({ column: { schema: 's', entity: "table1", name: "latitude" } });
            var longitudeFieldExpr = powerbi.data.SQExprBuilder.fieldExpr({ column: { schema: 's', entity: "table1", name: "longitude" } });

            var latitudeIdentities = this.sampleData[2].map(function (value) {
                var expr = powerbi.data.SQExprBuilder.equal(latitudeFieldExpr, powerbi.data.SQExprBuilder.double(value));
                return powerbi.data.createDataViewScopeIdentity(expr);
            });
            var longitudeIdentities = this.sampleData[1].map(function (value) {
                var expr = powerbi.data.SQExprBuilder.equal(longitudeFieldExpr, powerbi.data.SQExprBuilder.double(value));
                return powerbi.data.createDataViewScopeIdentity(expr);
            });
        
            // Metadata, describes the data columns, and provides the visual with hints
            // so it can decide how to best represent the data
            var dataViewMetadata: powerbi.DataViewMetadata = {
                columns: [
                    {
                        displayName: 'Latitude',
                        queryName: 'Latitude',
                        type: powerbi.ValueType.fromDescriptor({ numeric: true }),
                        roles: { Y: true }
                    },
                    {
                        displayName: 'Longitude',
                        queryName: 'Longitude',
                        type: powerbi.ValueType.fromDescriptor({ numeric: true }),
                        roles: { X: true }
                    },
                    {
                        displayName: 'Sales Amount',
                        isMeasure: true,
                        format: "$0,000.00",
                        queryName: 'sales1',
                        type: powerbi.ValueType.fromDescriptor({ numeric: true }),
                        objects: { dataPoint: { fill: { solid: { color: '#FF0000' } } } },
                        roles: { Size: true },

                    }
                ]
            };

            var columns = [
                {
                    source: dataViewMetadata.columns[2],
                    values: this.sampleData[0],
                    identity: { key: "sales1", expr: "" },
                }
            ];

            var dataValues: DataViewValueColumns = DataViewTransform.createValueColumns(columns, null, dataViewMetadata.columns[2]);

            return [{
                metadata: dataViewMetadata,
                categorical: {
                    categories: [
                        {
                            source: dataViewMetadata.columns[0],
                            values: this.sampleData[1],
                            identity: latitudeIdentities,
                        },
                        {
                            source: dataViewMetadata.columns[1],
                            values: this.sampleData[2],
                            identity: longitudeIdentities,
                        },
                    ],
                    values: dataValues
                }
            }];
        }


        public randomize(): void {

            this.sampleData[1] = this.sampleData[1].map((item) => {
                return this.getRandomValue(this.latitudeMin, this.latitudeMax);
            });
            this.sampleData[2] = this.sampleData[2].map((item) => {
                return this.getRandomValue(this.longitudeMin, this.longitudeMax);
            });

        }

    }
}