/*
 * Copyright 2015 - 2016 Anton Tananaev (anton@traccar.org)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

Ext.define('Traccar.view.MapController', {
    extend: 'Ext.app.ViewController',
    alias: 'controller.map',

    requires: [
        'Traccar.model.Position',
        'Traccar.model.Device',
        'Traccar.GeofenceConverter'
    ],

    config: {
        listen: {
            controller: {
                '*': {
                    selectdevice: 'selectDevice',
                    selectreport: 'selectReport',
                    mapstaterequest: 'getMapState'
                }
            },
            store: {
                '#Devices': {
                    add: 'updateDevice',
                    update: 'updateDevice'
                },
                '#LatestPositions': {
                    add: 'updateLatest',
                    update: 'updateLatest'
                },
                '#ReportRoute': {
                    load: 'loadReport',
                    clear: 'clearReport'
                },
                '#Geofences': {
                    load: 'showGeofences',
                    add: 'updateGeofences',
                    update: 'updateGeofences',
                    remove: 'updateGeofences'
                }
            },
            component: {
                '#': {
                    selectfeature: 'selectFeature'
                }
            }
        }
    },

    init: function () {
        this.latestMarkers = {};
        this.reportMarkers = {};
        this.liveRoutes = {};
        this.liveRouteLength = Traccar.app.getAttributePreference('web.liveRouteLength', 10);
        this.getView().header = {
            xtype: 'header',
            title: Strings.mapTitle,
            defaults: {
                xtype: 'button',
                tooltipType: 'title',
                margin: Traccar.Style.headerButtonsMargin
            },
            items: [{
                handler: 'showGeofences',
                reference: 'showGeofencesButton',
                glyph: 'xf21d@FontAwesome',
                enableToggle: true,
                pressed: true,
                tooltip: Strings.sharedGeofences
            }, {
                handler: 'showLiveRoutes',
                reference: 'showLiveRoutes',
                glyph: 'xf1b0@FontAwesome',
                enableToggle: true,
                tooltip: Strings.mapLiveRoutes
            }]
        };
    },

    getDeviceColor: function (device) {
        switch (device.get('status')) {
            case 'online':
                return Traccar.Style.mapColorOnline;
            case 'offline':
                return Traccar.Style.mapColorOffline;
            default:
                return Traccar.Style.mapColorUnknown;
        }
    },

    changeMarkerColor: function (style, color) {
        return new ol.style.Style({
            image: new ol.style.Arrow({
                radius: style.getImage().getRadius(),
                fill: new ol.style.Fill({
                    color: color
                }),
                stroke: style.getImage().getStroke(),
                rotation: style.getImage().getRotation()
            }),
            text: style.getText()
        });
    },

    updateDevice: function (store, data) {
        var i, device, deviceId, marker;

        if (!Ext.isArray(data)) {
            data = [data];
        }

        for (i = 0; i < data.length; i++) {
            device = data[i];
            deviceId = device.get('id');

            if (deviceId in this.latestMarkers) {
                marker = this.latestMarkers[deviceId];
                marker.setStyle(
                    this.changeMarkerColor(marker.getStyle(), this.getDeviceColor(device)));
            }
        }
    },

    followSelected: function () {
        return Ext.getCmp('deviceFollowButton') && Ext.getCmp('deviceFollowButton').pressed;
    },

    showLiveRoutes: function (button) {
        this.getView().getLiveRouteLayer().setVisible(button.pressed);
    },

    updateLatest: function (store, data) {
        var i, position, device;

        if (!Ext.isArray(data)) {
            data = [data];
        }

        for (i = 0; i < data.length; i++) {
            position = data[i];
            device = Ext.getStore('Devices').findRecord('id', position.get('deviceId'), 0, false, false, true);

            if (device) {
                this.updateLatestMarker(position, device);
                this.updateLiveRoute(position);
            }
        }
    },

    updateLatestMarker: function (position, device) {
        var geometry, deviceId, marker, style;
        geometry = new ol.geom.Point(ol.proj.fromLonLat([
            position.get('longitude'),
            position.get('latitude')
        ]));
        deviceId = position.get('deviceId');
        if (deviceId in this.latestMarkers) {
            marker = this.latestMarkers[deviceId];
            marker.setGeometry(geometry);
        } else {
            marker = new ol.Feature(geometry);
            marker.set('record', device);
            this.latestMarkers[deviceId] = marker;
            this.getView().getLatestSource().addFeature(marker);

            style = this.getLatestMarker(this.getDeviceColor(device));
            style.getText().setText(device.get('name'));
            marker.setStyle(style);
        }

        marker.getStyle().getImage().setRotation(position.get('course') * Math.PI / 180);

        if (marker === this.selectedMarker && this.followSelected()) {
            this.getView().getMapView().setCenter(marker.getGeometry().getCoordinates());
        }
    },

    updateLiveRoute: function (position) {
        var deviceId, liveLine, liveCoordinates, lastLiveCoordinates, newCoordinates;
        deviceId = position.get('deviceId');
        if (deviceId in this.liveRoutes) {
            liveCoordinates = this.liveRoutes[deviceId].getGeometry().getCoordinates();
            lastLiveCoordinates = liveCoordinates[liveCoordinates.length - 1];
            newCoordinates = ol.proj.fromLonLat([position.get('longitude'), position.get('latitude')]);
            if (lastLiveCoordinates[0] === newCoordinates[0] &&
                    lastLiveCoordinates[1] === newCoordinates[1]) {
                return;
            }
            if (liveCoordinates.length >= this.liveRouteLength) {
                liveCoordinates.shift();
            }
            liveCoordinates.push(newCoordinates);
            this.liveRoutes[deviceId].getGeometry().setCoordinates(liveCoordinates);
        } else {
            liveLine = new ol.Feature({
                geometry: new ol.geom.LineString([
                    ol.proj.fromLonLat([
                        position.get('longitude'),
                        position.get('latitude')
                    ])
                ])
            });
            liveLine.setStyle(this.getRouteStyle(deviceId));
            this.liveRoutes[deviceId] = liveLine;
            this.getView().getLiveRouteSource().addFeature(liveLine);
        }
    },

    loadReport: function (store, data) {
        var i, position, point, geometry, marker, style;

        this.clearReport(store);

        if (data.length > 0) {
            this.reportRoute = [];
            for (i = 0; i < data.length; i++) {
                if (i === 0 || data[i].get('deviceId') !== data[i - 1].get('deviceId')) {
                    this.reportRoute.push(new ol.Feature({
                        geometry: new ol.geom.LineString([])
                    }));
                    this.reportRoute[this.reportRoute.length - 1].setStyle(this.getRouteStyle(data[i].get('deviceId')));
                    this.getView().getRouteSource().addFeature(this.reportRoute[this.reportRoute.length - 1]);
                }
                position = data[i];

                point = ol.proj.fromLonLat([
                    position.get('longitude'),
                    position.get('latitude')
                ]);
                geometry = new ol.geom.Point(point);

                marker = new ol.Feature(geometry);
                marker.set('record', position);
                this.reportMarkers[position.get('id')] = marker;
                this.getView().getReportSource().addFeature(marker);

                style = this.getReportMarker(position.get('deviceId'));
                style.getImage().setRotation(position.get('course') * Math.PI / 180);
                /*style.getText().setText(
                    Ext.Date.format(position.get('fixTime'), Traccar.Style.dateTimeFormat24));*/

                marker.setStyle(style);

                this.reportRoute[this.reportRoute.length - 1].getGeometry().appendCoordinate(point);
            }

            this.getView().getMapView().fit(this.reportRoute[0].getGeometry(), this.getView().getMap().getSize());
        }
    },

    clearReport: function (store) {
        var key, i;

        if (this.reportRoute) {
            for (i = 0; i < this.reportRoute.length; i++) {
                this.getView().getRouteSource().removeFeature(this.reportRoute[i]);
            }
            this.reportRoute = null;
        }

        if (this.reportMarkers) {
            for (key in this.reportMarkers) {
                if (this.reportMarkers.hasOwnProperty(key)) {
                    this.getView().getReportSource().removeFeature(this.reportMarkers[key]);
                }
            }
            this.reportMarkers = {};
        }
    },

    getRouteStyle: function (deviceId) {
        var index = 0;
        if (deviceId !== undefined) {
            index = deviceId % Traccar.Style.mapRouteColor.length;
        }
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: Traccar.Style.mapRouteColor[index],
                width: Traccar.Style.mapRouteWidth
            })
        });
    },

    getMarkerStyle: function (radius, color) {
        return new ol.style.Style({
            image: new ol.style.Arrow({
                radius: radius,
                fill: new ol.style.Fill({
                    color: color
                }),
                stroke: new ol.style.Stroke({
                    color: Traccar.Style.mapArrowStrokeColor,
                    width: Traccar.Style.mapArrowStrokeWidth
                })
            }),
            text: new ol.style.Text({
                textBaseline: 'bottom',
                fill: new ol.style.Fill({
                    color: Traccar.Style.mapTextColor
                }),
                stroke: new ol.style.Stroke({
                    color: Traccar.Style.mapTextStrokeColor,
                    width: Traccar.Style.mapTextStrokeWidth
                }),
                offsetY: -radius / 2 - Traccar.Style.mapTextOffset,
                font : Traccar.Style.mapTextFont
            })
        });
    },

    getLatestMarker: function (color) {
        return this.getMarkerStyle(
            Traccar.Style.mapRadiusNormal, color);
    },

    getReportMarker: function (deviceId) {
        var index = 0;
        if (deviceId !== undefined) {
            index = deviceId % Traccar.Style.mapRouteColor.length;
        }
        return this.getMarkerStyle(
            Traccar.Style.mapRadiusNormal, Traccar.Style.mapRouteColor[index]);
    },

    resizeMarker: function (style, radius) {
        return new ol.style.Style({
            image: new ol.style.Arrow({
                radius: radius,
                fill: style.getImage().getFill(),
                stroke: style.getImage().getStroke(),
                rotation: style.getImage().getRotation()
            }),
            text: style.getText()
        });
    },

    selectMarker: function (marker, center) {
        if (this.selectedMarker) {
            this.selectedMarker.setStyle(
                this.resizeMarker(this.selectedMarker.getStyle(), Traccar.Style.mapRadiusNormal));
        }

        if (marker) {
            marker.setStyle(
                this.resizeMarker(marker.getStyle(), Traccar.Style.mapRadiusSelected));
            if (center) {
                this.getView().getMapView().setCenter(marker.getGeometry().getCoordinates());
            }
        }

        this.selectedMarker = marker;
    },

    selectDevice: function (device, center) {
        this.selectMarker(this.latestMarkers[device.get('id')], center);
    },

    selectReport: function (position, center) {
        if (position instanceof Traccar.model.Position) {
            this.selectMarker(this.reportMarkers[position.get('id')], center);
        }
    },

    selectFeature: function (feature) {
        var record = feature.get('record');
        if (record) {
            if (record instanceof Traccar.model.Device) {
                this.fireEvent('selectdevice', record, false);
            } else {
                this.fireEvent('selectreport', record, false);
            }
        }
    },

    getMapState: function () {
        var zoom, center, projection;
        projection = this.getView().getMapView().getProjection();
        center = ol.proj.transform(this.getView().getMapView().getCenter(), projection, 'EPSG:4326');
        zoom = this.getView().getMapView().getZoom();
        this.fireEvent('mapstate', center[1], center[0], zoom);
    },

    getGeofenceStyle: function (label) {
        return new ol.style.Style({
                fill: new ol.style.Fill({
                    color: Traccar.Style.mapGeofenceOverlay
                }),
                stroke: new ol.style.Stroke({
                    color: Traccar.Style.mapGeofenceColor,
                    width: Traccar.Style.mapGeofenceWidth
                }),
                text: new ol.style.Text({
                    text: label,
                    fill: new ol.style.Fill({
                        color: Traccar.Style.mapGeofenceTextColor
                    }),
                    stroke: new ol.style.Stroke({
                        color: Traccar.Style.mapTextStrokeColor,
                        width: Traccar.Style.mapTextStrokeWidth
                    }),
                    font : Traccar.Style.mapTextFont
                })
            });
    },

    showGeofences: function () {
        if (this.lookupReference('showGeofencesButton').pressed) {
            Ext.getStore('Geofences').each(function (geofence) {
                var feature = new ol.Feature(Traccar.GeofenceConverter
                        .wktToGeometry(this.getView().getMapView(), geofence.get('area')));
                feature.setStyle(this.getGeofenceStyle(geofence.get('name')));
                this.getView().getGeofencesSource().addFeature(feature);
                return true;
            }, this);
        } else {
            this.getView().getGeofencesSource().clear();
        }
    },

    updateGeofences: function () {
        if (this.lookupReference('showGeofencesButton').pressed) {
            this.getView().getGeofencesSource().clear();
            this.showGeofences();
        }
    }
});
