$(function() {
    function ControlViewModel(parameters) {
        var self = this;

        self.loginState = parameters[0];
        self.settings = parameters[1];
	    self.printerState = parameters[2];

		self._focus_timout = undefined;
        self._miraOn = false;

        self._createToolEntry = function () {
            return {
                name: ko.observable(),
                key: ko.observable()
            }
        };


        self.isErrorOrClosed = ko.observable(undefined);
        self.isOperational = ko.observable(undefined);
        self.isPrinting = ko.observable(undefined);
        self.isPaused = ko.observable(undefined);
        self.isError = ko.observable(undefined);
        self.isReady = ko.observable(undefined);
        self.isLoading = ko.observable(undefined);
        self.isLocked = ko.observable(undefined);
        self.isFlashing = ko.observable(false);
		self.isFocusing = ko.observable(false);

        self.isTeste = ko.observable(undefined);


        self.extrusionAmount = ko.observable(undefined);
        self.controls = ko.observableArray([]);

        self.tools = ko.observableArray([]);

        self.feedRate = ko.observable(100);
        self.flowRate = ko.observable(100);

        self.feedbackControlLookup = {};

        self.controlsFromServer = [];
        self.additionalControls = [];

        self.webcamDisableTimeout = undefined;

        self.keycontrolActive = ko.observable(false);
        self.keycontrolHelpActive = ko.observable(false);
        self.keycontrolPossible = ko.computed(function () {
            return self.isOperational() && !self.isPrinting() && self.loginState.isUser() && !$.browser.mobile;
        });
        self.showKeycontrols = ko.computed(function () {
            return self.keycontrolActive() && self.keycontrolPossible();
        });

        self.settings.printerProfiles.currentProfileData.subscribe(function () {
            self._updateExtruderCount();
            self.settings.printerProfiles.currentProfileData().extruder.count.subscribe(self._updateExtruderCount);
        });
        self._updateExtruderCount = function () {
            var tools = [];

            var numExtruders = self.settings.printerProfiles.currentProfileData().extruder.count();
            if (numExtruders > 1) {
                // multiple extruders
                for (var extruder = 0; extruder < numExtruders; extruder++) {
                    tools[extruder] = self._createToolEntry();
                    tools[extruder]["name"](gettext("Tool") + " " + extruder);
                    tools[extruder]["key"]("tool" + extruder);
                }
            } else {
                // only one extruder, no need to add numbers
                tools[0] = self._createToolEntry();
                tools[0]["name"](gettext("Hotend"));
                tools[0]["key"]("tool0");
            }

            self.tools(tools);
        };

        self.fromCurrentData = function (data) {
            self._processStateData(data.state);
        };

        self.fromHistoryData = function (data) {
            self._processStateData(data.state);
        };

        self._processStateData = function (data) {
            self.isErrorOrClosed(data.flags.closedOrError);
            self.isOperational(data.flags.operational);
            self.isPaused(data.flags.paused);
            self.isTeste(data.flags.testando);
            self.isPrinting(data.flags.printing);
            self.isError(data.flags.error);
            self.isReady(data.flags.ready);
            self.isLoading(data.flags.loading);
			self.isLocked(data.flags.locked);
			self.isFlashing(data.flags.flashing);
        };

        self.onEventSettingsUpdated = function (payload) {
            self.requestData();
        };

        self.onEventRegisteredMessageReceived = function(payload) {
            if (payload.key in self.feedbackControlLookup) {
                var outputs = self.feedbackControlLookup[payload.key];
                _.each(payload.outputs, function(value, key) {
                    if (outputs.hasOwnProperty(key)) {
                        outputs[key](value);
                    }
                });
            }
        };
		

        self.rerenderControls = function () {
            var allControls = self.controlsFromServer.concat(self.additionalControls);
            self.controls(self._processControls(allControls));
        };

		self.requestData = function () {
            $.ajax({
                url: API_BASEURL + "printer/command/custom",
                method: "GET",
                dataType: "json",
                success: function (response) {
                    self._fromResponse(response);
                }
            });
        };

        self._fromResponse = function (response) {
            self.controlsFromServer = response.controls;
            self.rerenderControls();
        };

        self._processControls = function (controls) {
            for (var i = 0; i < controls.length; i++) {
                controls[i] = self._processControl(controls[i]);
            }
            return controls;
        };

        self._processControl = function (control) {
            if (control.hasOwnProperty("processed") && control.processed) {
                return control;
            }

            if (control.hasOwnProperty("template") && control.hasOwnProperty("key") && control.hasOwnProperty("template_key") && !control.hasOwnProperty("output")) {
                control.output = ko.observable(control.default || "");
                if (!self.feedbackControlLookup.hasOwnProperty(control.key)) {
                    self.feedbackControlLookup[control.key] = {};
                }
                self.feedbackControlLookup[control.key][control.template_key] = control.output;
            }

            if (control.hasOwnProperty("children")) {
                control.children = ko.observableArray(self._processControls(control.children));
                if (!control.hasOwnProperty("layout") || !(control.layout == "vertical" || control.layout == "horizontal" || control.layout == "horizontal_grid")) {
                    control.layout = "vertical";
                }

                if (!control.hasOwnProperty("collapsed")) {
                    control.collapsed = false;
                }
            }

            if (control.hasOwnProperty("input")) {
                var attributeToInt = function(obj, key, def) {
                    if (obj.hasOwnProperty(key)) {
                        var val = obj[key];
                        if (_.isNumber(val)) {
                            return val;
                        }

                        var parsedVal = parseInt(val);
                        if (!isNaN(parsedVal)) {
                            return parsedVal;
                        }
                    }
                    return def;
                };

                _.each(control.input, function (element) {
                    if (element.hasOwnProperty("slider") && _.isObject(element.slider)) {
                        element.slider["min"] = attributeToInt(element.slider, "min", 0);
                        element.slider["max"] = attributeToInt(element.slider, "max", 255);

                        // try defaultValue, default to min
                        var defaultValue = attributeToInt(element, "default", element.slider.min);

                        // if default value is not within range of min and max, correct that
                        if (!_.inRange(defaultValue, element.slider.min, element.slider.max)) {
                            // use bound closer to configured default value
                            defaultValue = defaultValue < element.slider.min ? element.slider.min : element.slider.max;
                        }

                        element.value = ko.observable(defaultValue);
                    } else {
                        element.slider = false;
                        element.value = ko.observable((element.hasOwnProperty("default")) ? element["default"] : undefined);
                    }
                });
            }

            var js;
            if (control.hasOwnProperty("javascript")) {
                js = control.javascript;

                // if js is a function everything's fine already, but if it's a string we need to eval that first
                if (!_.isFunction(js)) {
                    control.javascript = function (data) {
                        eval(js);
                    };
                }
            }

            if (control.hasOwnProperty("enabled")) {
                js = control.enabled;

                // if js is a function everything's fine already, but if it's a string we need to eval that first
                if (!_.isFunction(js)) {
                    control.enabled = function (data) {
                        return eval(js);
                    }
                }
            }

            control.processed = true;
            return control;
        };

        self.isCustomEnabled = function (data) {
            if (data.hasOwnProperty("enabled")) {
                return data.enabled(data);
            } else {
                return self.isOperational() && self.loginState.isUser();
            }
        };

        self.clickCustom = function (data) {
            var callback;
            if (data.hasOwnProperty("javascript")) {
                callback = data.javascript;
            } else {
                callback = self.sendCustomCommand;
            }

            if (data.confirm) {
                showConfirmationDialog(data.confirm, function (e) {
                    callback(data);
                });
            } else {
                callback(data);
            }
        };

        self.sendJogCommand = function (axis, multiplier, distance) {
            if (typeof distance === "undefined")
//                distance = $('#jog_distance button.active').data('distance');
				distance = self.jogDistanceInMM();
            if (self.settings.printerProfiles.currentProfileData() && self.settings.printerProfiles.currentProfileData()["axes"] && self.settings.printerProfiles.currentProfileData()["axes"][axis] && self.settings.printerProfiles.currentProfileData()["axes"][axis]["inverted"]()) {
                multiplier *= -1;
            }

            var data = {
                "command": "jog"
            };
            data[axis] = distance * multiplier;

            self.sendPrintHeadCommand(data);
        };

        self.sendHomeCommand = function (axis) {
            self.sendPrintHeadCommand({
                "command": "home",
                "axes": axis
            });
        };
		
		self.sendCancelCommand = function () {
            self.sendCustomCommand({
                "command": "R",
            });
        };

        self.sendFeedRateCommand = function () {
            self.sendPrintHeadCommand({
                "command": "feedrate",
                "factor": self.feedRate()
            });
        };

        self.sendExtrudeCommand = function () {
            self._sendECommand(1);
        };

        self.sendRetractCommand = function () {
            self._sendECommand(-1);
        };

        self.sendFlowRateCommand = function () {
            self.sendToolCommand({
                "command": "flowrate",
                "factor": self.flowRate()
            });
        };

        self._sendECommand = function (dir) {
            var length = self.extrusionAmount();
            if (!length) length = self.settings.printer_defaultExtrusionLength();

            self.sendToolCommand({
                command: "extrude",
                amount: length * dir
            });
        };

        self.sendSelectToolCommand = function (data) {
            if (!data || !data.key()) return;

            self.sendToolCommand({
                command: "select",
                tool: data.key()
            });
        };
		
		self.cancel_teste = function() {
            self._jobCommand("cancel_teste");
        };
		
		self._jobCommand = function(command, callback) {
            $.ajax({
                url: API_BASEURL + "printer/cancel_teste",
                type: "POST",
                dataType: "json",
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify({command: command}),
                success: function(response) {
                    if (callback != undefined) {
                        callback();
                    }
                }
            });
        };

        self.sendPrintHeadCommand = function (data) {
            $.ajax({
                url: API_BASEURL + "printer/printhead",
                type: "POST",
                dataType: "json",
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify(data)
            });
        };

        self.sendToolCommand = function (data) {
            $.ajax({
                url: API_BASEURL + "printer/tool",
                type: "POST",
                dataType: "json",
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify(data)
            });
        };

        self.sendCustomCommand = function (command) {
            if (!command)
                return;

            var data = undefined;
            if (command.hasOwnProperty("command")) {
                // single command
                data = {"command": command.command};
            } else if (command.hasOwnProperty("commands")) {
                // multi command
                data = {"commands": command.commands};
            } else if (command.hasOwnProperty("script")) {
                data = {"script": command.script};
                if (command.hasOwnProperty("context")) {
                    data["context"] = command.context;
                }
            } else {
                return;
            }

            if (command.hasOwnProperty("input")) {
                // parametric command(s)
                data["parameters"] = {};
                _.each(command.input, function(input) {
                    if (!input.hasOwnProperty("parameter") || !input.hasOwnProperty("value")) {
                        return;
                    }

                    data["parameters"][input.parameter] = input.value();
                });
            }

            $.ajax({
                url: API_BASEURL + "printer/command",
                type: "POST",
                dataType: "json",
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify(data)
            });
        };

        self.displayMode = function (customControl) {
            if (customControl.hasOwnProperty("children")) {
                if (customControl.name) {
                    return "customControls_containerTemplate_collapsable";
                } else {
                    return "customControls_containerTemplate_nameless";
                }
            } else {
                return "customControls_controlTemplate";
            }
        };

        self.rowCss = function (customControl) {
            var span = "span2";
            var offset = "";
            if (customControl.hasOwnProperty("width")) {
                span = "span" + customControl.width;
            }
            if (customControl.hasOwnProperty("offset")) {
                offset = "offset" + customControl.offset;
            }
            return span + " " + offset;
        };

        self.onStartup = function () {
            self.requestData();
			self._configureJogDistanceSlider();
			self._configuraMaterialTesting();
			$('#manual_position').keyup(function(e) {
				if (e.which === 13){ // 13 == enter
					self.manualPosition();
				 }
			});
        };

		self.updateRotatorWidth = function() {
            var webcamImage = $("#webcam_image");
            if (self.settings.webcam_rotate90()) {
                if (webcamImage.width() > 0) {
                    $("#webcam_rotator").css("height", webcamImage.width());
                } else {
                    webcamImage.off("load.rotator");
                    webcamImage.on("load.rotator", function() {
                        $("#webcam_rotator").css("height", webcamImage.width());
                        webcamImage.off("load.rotator");
                    });
                }
            } else {
                $("#webcam_rotator").css("height", "");
            }
        }

        self.onSettingsBeforeSave = self.updateRotatorWidth;

        self.onTabChange = function (current, previous) {
            if (current == "#control") {
                if (self.webcamDisableTimeout != undefined) {
                    clearTimeout(self.webcamDisableTimeout);
                }
                var webcamImage = $("#webcam_image");
                var currentSrc = webcamImage.attr("src");
                if (currentSrc === undefined || currentSrc.trim() == "") {
                    var newSrc = CONFIG_WEBCAM_STREAM;
                    if (CONFIG_WEBCAM_STREAM.lastIndexOf("?") > -1) {
                        newSrc += "&";
                    } else {
                        newSrc += "?";
                    }
                    newSrc += new Date().getTime();

                    self.updateRotatorWidth();
                    webcamImage.attr("src", newSrc);
                }
            } else if (previous == "#control") {
                // only disable webcam stream if tab is out of focus for more than 5s, otherwise we might cause
                // more load by the constant connection creation than by the actual webcam stream
                self.webcamDisableTimeout = setTimeout(function () {
                    $("#webcam_image").attr("src", "");
                }, 5000);
            }
        };

        self.onAllBound = function (allViewModels) {
            var additionalControls = [];
            _.each(allViewModels, function (viewModel) {
                if (viewModel.hasOwnProperty("getAdditionalControls")) {
                    additionalControls = additionalControls.concat(viewModel.getAdditionalControls());
                }
            });
            if (additionalControls.length > 0) {
                self.additionalControls = additionalControls;
                self.rerenderControls();
            }
        };

		self._jogDistanceMapping = [0.1, 1, 5, 10, 50, 100];
		self._configureJogDistanceSlider = function () {
			self.layerSlider = $("#jogDistance").slider({
				id: "jogDistanceSlider",
				reversed: false,
				selection: "after",
				orientation: "horizontal",
				min: 0,
				max: self._jogDistanceMapping.length - 1,
				step: 1,
				value: 3,
				enabled: true,
				formatter: function (value) {
					return self._jogDistanceMapping[value] + "mm";
				}
			}).on("slide", self.updateJogDistance);
			self.updateJogDistance();

		};
		
		self._configuraMaterialTesting = function () {
			var velocidade = $("#velocidade");
			var potencia = $("#potencia");
			var npasses = $("#npasses");
			velocidade.bind('keyup mouseup', self.atualizavelocidade);
			/* velocidade.attr("placeholder", "Type your answer here"); */
			
		};
		
		self.atualizavelocidade = function() {
			var velocidade = $("#velocidade");
			console.log(velocidade.val());
		}

		self.updateJogDistance = function () {
			var val = self._jogDistanceMapping[$("#jogDistance").slider('getValue')];
			self.jogDistanceInMM(val);
		};

        self.onFocus = function (data, event) {
            if (!self.settings.feature_keyboardControl()) return;
            self.keycontrolActive(true);
        };

        self.onMouseOver = function (data, event) {
            if (!self.settings.feature_keyboardControl()) return;
            $("#webcam_container").focus();
            self.keycontrolActive(true);
        };

        self.onMouseOut = function (data, event) {
            if (!self.settings.feature_keyboardControl()) return;
            $("#webcam_container").blur();
            self.keycontrolActive(false);
        };

        self.toggleKeycontrolHelp = function () {
            self.keycontrolHelpActive(!self.keycontrolHelpActive());
        };

        self.onKeyDown = function (data, event) {
            if (!self.settings.feature_keyboardControl()) return;

            var button = undefined;
            var visualizeClick = true;
            switch (event.which) {
                case 37: // left arrow key
                    // X-
                    button = $("#control-xdec");
                    break;
                case 38: // up arrow key
                    // Y+
                    button = $("#control-yinc");
                    break;
                case 39: // right arrow key
                    // X+
                    button = $("#control-xinc");
                    break;
                case 40: // down arrow key
                    // Y-
                    button = $("#control-ydec");
                    break;
                case 49: // number 1
                case 97: // numpad 1
                    // Distance 0.1
                    button = $("#control-distance01");
                    visualizeClick = false;
                    break;
                case 50: // number 2
                case 98: // numpad 2
                    // Distance 1
                    button = $("#control-distance1");
                    visualizeClick = false;
                    break;
                case 51: // number 3
                case 99: // numpad 3
                    // Distance 10
                    button = $("#control-distance10");
                    visualizeClick = false;
                    break;
                case 52: // number 4
                case 100: // numpad 4
                    // Distance 100
                    button = $("#control-distance100");
                    visualizeClick = false;
                    break;
                case 33: // page up key
                case 87: // w key
                    // z lift up
                    button = $("#control-zinc");
                    break;
                case 34: // page down key
                case 83: // s key
                    // z lift down
                    button = $("#control-zdec");
                    break;
                case 36: // home key
                    // xy home
                    button = $("#control-xyhome");
                    break;
                case 35: // end key
                    // z home
                    button = $("#control-zhome");
                    break;
                default:
                    event.preventDefault();
                    return false;
            }

            if (button === undefined) {
                return false;
            } else {
                event.preventDefault();
                if (visualizeClick) {
                    button.addClass("active");
                    setTimeout(function () {
                        button.removeClass("active");
                    }, 150);
                }
                button.click();
            }
        };
		self.laserPos = ko.computed(function () {
			var pos = self.printerState.currentPos();
			if (!pos) {
				return "(?, ?)";
			} else {
				return "(" + pos.x + ", " + pos.y + ")";
			}
		}, this);

		self.setCoordinateOrigin = function () {
			self.sendCustomCommand({type: 'command', command: "G92 X0 Y0"});
		};
		
		self.manualPosition = function(){
					$('#manual_position').removeClass('warning');
			var s = $('#manual_position').val();
			var tmp = s.split(/[^0-9.,-\\+]+/);
			if (tmp.length === 2) {
				var x = parseFloat(tmp[0]);
				var y = parseFloat(tmp[1]);
				if(!isNaN(x) && !isNaN(y)) {
					self.sendCustomCommand({type: 'command', command: "G0X"+x+"Y"+y});
					$('#manual_position').val('');
				} else {
					$('#manual_position').addClass('warning');
				}
			} else {
				$('#manual_position').addClass('warning');
			}
		};

		self.jogDistanceInMM = ko.observable(undefined);


		self.focus_on = function () {
			var callback = function (e) {
				if (typeof self._focus_timout !== 'undefined') {
					clearTimeout(self._focus_timout);
				}

				e.preventDefault();
				$("#confirmation_dialog").modal("hide");
				self.sendCustomCommand({type: 'commands', commands: ['M8', 'M3S45']});
				self._focus_timout = setTimeout(function () { // switch focus off after 30 seconds for safety reasons.
					self.focus_off();
					new PNotify({
						title: gettext("Laser Desligado"),
						text: gettext("Por razões de segurança o modo de foco é desativado após 30 segundos.")
					});
				}, 30000);
			};

			self.printerState.show_safety_glasses_warning(callback);
		};
		
		self.material_test = function () {
			var callback = function (e) {
				e.preventDefault();
				$("#confirmation_dialog").modal("hide");
				var velocidade = $("#velocidade").val();
				var potencia = $("#potencia").val();
				var npasses = $("#npasses").val();
				
				if (velocidade<1){
					velocidade=1;
				}
				
				if (velocidade>100){
					velocidade=100;
				}
				
				if (potencia<1){
					potencia=1;
				}
				
				if (potencia>100){
					potencia=100;
				}							
				
				if (npasses<1){
					npasses=1;
				}
				
				if (npasses>10){
					npasses=10;
				}
				
				potencia=parseInt((potencia*890)/100) + 100;
				velocidade=parseInt((velocidade*5000)/100)+100;

						
				console.log(velocidade)				
				console.log(potencia)				
				console.log(npasses)	
				
				var commandSequence_inicio=[
						"M8",
						"G90",
						"G21",						
						"G1 F"+velocidade,	
						"G1 X14.8675 Y30.2595",
						"M03", "S"+potencia,
						];

				var commandSequence=[
						"M8",
						"G90",
						"G21",						
						"G0 X14.8675 Y30.2595",
						"G1 F"+velocidade,	
						"M03", "S"+potencia,
						"G1 X0. Y30.",
						"G1 X0. Y10.2227",
						"G1 X1.7824 Y8.4403",
						"G1 X3.9396 Y6.2828",
						"G1 X3.9396 Y26.325",
						"G1 X14.8675 Y26.325",
						"G2 X22.7879 Y23.045 I-0. J-11.2028",
						"G2 X26.0663 Y15.1321 I-7.9105 J-7.9129",
						"G2 X22.7851 Y7.2171 I-11.1871 J0.",
						"G2 X14.8675 Y3.9402 I-7.9175 J7.9267",
						"G1 X6.2825 Y3.9402",
						"G1 X10.223 Y0.",
						"G1 X14.8672 Y0.",
						"G3 X25.5681 Y4.4325 I-0. J15.1333",
						"G3 X30. Y15.1321 I-10.6997 J10.6996",
						"G3 X25.57 Y25.8267 I-15.1228 J0.0005",
						"G3 X14.8675 Y30.2595 I-10.7025 J-10.7037",		
						'M05 S0', 
						'M9', 
						"G0 X0 Y0"						
						];
						
				for(i=0;i<npasses;i++){
				self.sendCustomCommand({type: 'commands', commands: commandSequence});
				}
			};

			self.printerState.show_safety_glasses_warning(callback);
		};
		

        self.mira_on = function () {


           // var callback = function (e) {
                if (typeof self._focus_timout !== 'undefined') {
                    clearTimeout(self._focus_timout);
                }
                self.sendCustomCommand({type: 'commands', commands: ['M8', 'M3S115']});


                //e.preventDefault();
                //self._miraOn = false;
                //$("#confirmation_dialog").modal("hide");
                //self._focus_timout = setTimeout(function () { // switch focus off after 30 seconds for safety reasons.
                //    self.focus_off();
                //    new PNotify({
                //        title: gettext("Laser Desligado"),
                //        text: gettext("Por razões de segurança a mira é desativada após 30 segundos.")
                //    });
                //}, 5000);
          //  };

            
        //    self.printerState.show_safety_glasses_warning(callback);
        };

      self.mira_off = function () {
            if(typeof self._focus_timout !== 'undefined'){
                clearTimeout(self._focus_timout);
            }
            self.sendCustomCommand({type: 'commands', commands: ['M5', 'M9']});
        };

    
		self.focus_off = function () {
			if(typeof self._focus_timout !== 'undefined'){
				clearTimeout(self._focus_timout);
			}
			self.sendCustomCommand({type: 'commands', commands: ['M5', 'M9']});
		};

    }

    OCTOPRINT_VIEWMODELS.push([
        ControlViewModel,
        ["loginStateViewModel", "settingsViewModel", 'printerStateViewModel'],
        ["#control", '#focus']
    ]);
});
