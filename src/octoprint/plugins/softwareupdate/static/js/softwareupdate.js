$(function() {
    function SoftwareUpdateViewModel(parameters) {
        var self = this;

        self.loginState = parameters[0];
        self.printerState = parameters[1];
        self.settings = parameters[2];
        self.popup = undefined;

        self.updateInProgress = false;
        self.waitingForRestart = false;
        self.restartTimeout = undefined;

        self.currentlyBeingUpdated = [];

        self.octoprintUnconfigured = ko.observable();
        self.octoprintUnreleased = ko.observable();

        self.config_cacheTtl = ko.observable();
        self.config_checkoutFolder = ko.observable();
        self.config_checkType = ko.observable();

        self.configurationDialog = $("#settings_plugin_softwareupdate_configurationdialog");

        self.config_availableCheckTypes = [
            {"key": "github_release", "name": gettext("Release")},
            {"key": "git_commit", "name": gettext("Commit")}
        ];

        self.versions = new ItemListHelper(
            "plugin.softwareupdate.versions",
            {
                "name": function(a, b) {
                    // sorts ascending, puts octoprint first
                    if (a.key.toLocaleLowerCase() == "octoprint") return -1;
                    if (b.key.toLocaleLowerCase() == "octoprint") return 1;

                    if (a.displayName.toLocaleLowerCase() < b.displayName.toLocaleLowerCase()) return -1;
                    if (a.displayName.toLocaleLowerCase() > b.displayName.toLocaleLowerCase()) return 1;
                    return 0;
                }
            },
            {},
            "name",
            [],
            [],
            5
        );

        self.onUserLoggedIn = function() {
            self.performCheck();
        };

        self._showPopup = function(options, eventListeners) {
            self._closePopup();
            self.popup = new PNotify(options);

            if (eventListeners) {
                var popupObj = self.popup.get();
                _.each(eventListeners, function(value, key) {
                    popupObj.on(key, value);
                })
            }
        };

        self._updatePopup = function(options) {
            if (self.popup === undefined) {
                self._showPopup(options);
            } else {
                self.popup.update(options);
            }
        };

        self._closePopup = function() {
            if (self.popup !== undefined) {
                self.popup.remove();
            }
        };

        self.showPluginSettings = function() {
            self._copyConfig();
            self.configurationDialog.modal();
        };

        self.savePluginSettings = function() {
            var data = {
                plugins: {
                    softwareupdate: {
                        cache_ttl: parseInt(self.config_cacheTtl()),
                        octoprint_checkout_folder: self.config_checkoutFolder(),
                        octoprint_type: self.config_checkType()
                    }
                }
            };
            self.settings.saveData(data, function() {
                self.configurationDialog.modal("hide");
                self._copyConfig();
                self.performCheck();
            });
        };

        self._copyConfig = function() {
            self.config_cacheTtl(self.settings.settings.plugins.softwareupdate.cache_ttl());
            self.config_checkoutFolder(self.settings.settings.plugins.softwareupdate.octoprint_checkout_folder());
            self.config_checkType(self.settings.settings.plugins.softwareupdate.octoprint_type());
        };

        self.fromCheckResponse = function(data, ignoreSeen, showIfNothingNew) {
            var versions = [];
            _.each(data.information, function(value, key) {
                value["key"] = key;

                if (!value.hasOwnProperty("displayName") || value.displayName == "") {
                    value.displayName = value.key;
                }
                if (!value.hasOwnProperty("displayVersion") || value.displayVersion == "") {
                    value.displayVersion = value.information.local.name;
                }

                versions.push(value);
            });
            self.versions.updateItems(versions);

            var octoprint = data.information["octoprint"];
            if (octoprint && octoprint.hasOwnProperty("check")) {
                var check = octoprint.check;
                if (BRANCH != "master" && check["type"] == "github_release") {
                    self.octoprintUnreleased(true);
                } else {
                    self.octoprintUnreleased(false);
                }

                var checkoutFolder = (check["checkout_folder"] || "").trim();
                var updateFolder = (check["update_folder"] || "").trim();
                var checkType = check["type"] || "";
                if ((checkType == "github_release" || checkType == "git_commit") && checkoutFolder == "" && updateFolder == "") {
                    self.octoprintUnconfigured(true);
                } else {
                    self.octoprintUnconfigured(false);
                }
            }

            if (data.status == "updateAvailable" || data.status == "updatePossible") {
                var text = gettext("Existem atualizações:");

                text += "<ul>";
                _.each(self.versions.items(), function(update_info) {
                    if (update_info.updateAvailable) {
                        var displayName = update_info.key;
                        if (update_info.hasOwnProperty("displayName")) {
                            displayName = update_info.displayName;
                        }
                        text += "<li>" + displayName + (update_info.updatePossible ? " <i class=\"icon-ok\"></i>" : "") + "</li>";
                    }
                });
                text += "</ul>";

                text += "<small>" + gettext("Os itens marcados com <i class=\"icon-ok\"></i> podem ser atualizados.") + "</small>";

                var options = {
                    title: gettext("Atualização Due disponível"),
                    text: text,
                    hide: false
                };
                var eventListeners = {};

                if (data.status == "updatePossible" && self.loginState.isAdmin()) {
                    // if user is admin, add action buttons
                    options["confirm"] = {
                        confirm: true,
                        buttons: [{
                            text: gettext("Ignorar"),
                            click: function() {
                                self._markNotificationAsSeen(data.information);
                                self._showPopup({
                                    text: gettext("Voce pode tentar mais tarde")
                                });
                            }
                        }, {
                            text: gettext("Atualizar agora"),
                            addClass: "btn-primary",
                            click: self.update
                        }]
                    };
                    options["buttons"] = {
                        closer: false,
                        sticker: false
                    };
                }

                if (ignoreSeen || !self._hasNotificationBeenSeen(data.information)) {
                    self._showPopup(options, eventListeners);
                }
            } else if (data.status == "current") {
                if (showIfNothingNew) {
                    self._showPopup({
                        title: gettext("Tudo atualizado!"),
                        hide: false,
                        type: "success"
                    });
                } else {
                    self._closePopup();
                }
            }
        };

        self.performCheck = function(showIfNothingNew, force, ignoreSeen) {
            if (!self.loginState.isUser()) return;

            var url = PLUGIN_BASEURL + "softwareupdate/check";
            if (force) {
                url += "?force=true";
            }

            $.ajax({
                url: url,
                type: "GET",
                dataType: "json",
                success: function(data) {
                    self.fromCheckResponse(data, ignoreSeen, showIfNothingNew);
                }
            });
        };

        self._markNotificationAsSeen = function(data) {
            if (!Modernizr.localstorage)
                return false;
            localStorage["plugin.softwareupdate.seen_information"] = JSON.stringify(self._informationToRemoteVersions(data));
        };

        self._hasNotificationBeenSeen = function(data) {
            if (!Modernizr.localstorage)
                return false;

            if (localStorage["plugin.softwareupdate.seen_information"] == undefined)
                return false;

            var knownData = JSON.parse(localStorage["plugin.softwareupdate.seen_information"]);
            var freshData = self._informationToRemoteVersions(data);

            var hasBeenSeen = true;
            _.each(freshData, function(value, key) {
                if (!_.has(knownData, key) || knownData[key] != freshData[key]) {
                    hasBeenSeen = false;
                }
            });
            return hasBeenSeen;
        };

        self._informationToRemoteVersions = function(data) {
            var result = {};
            _.each(data, function(value, key) {
                result[key] = value.information.remote.value;
            });
            return result;
        };

        self.performUpdate = function(force) {
            self.updateInProgress = true;

            var options = {
                title: gettext("Atualizando..."),
                text: gettext("Atualizando, por favor aguarde."),
                icon: "icon-cog icon-spin",
                hide: false,
                buttons: {
                    closer: false,
                    sticker: false
                }
            };
            self._showPopup(options);

            $.ajax({
                url: PLUGIN_BASEURL + "softwareupdate/update",
                type: "POST",
                dataType: "json",
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify({force: (force == true)}),
                error: function() {
                    self.updateInProgress = false;
                    self._showPopup({
                        title: gettext("Atualização não iniciada!"),
                        text: gettext("Não foi possível atualizar, tente novamente mais tarde"),
                        type: "error",
                        hide: false,
                        buttons: {
                            sticker: false
                        }
                    });
                },
                success: function(data) {
                    self.currentlyBeingUpdated = data.checks;
                }
            });
        };

        self.update = function(force) {
            if (self.updateInProgress) return;
            if (!self.loginState.isAdmin()) return;

            force = (force == true);

            if (self.printerState.isPrinting()) {
                self._showPopup({
                    title: gettext("Não é possível atualizar"),
                    text: gettext("Espere o serviço terminar para atualizar"),
                    type: "error"
                });
            } else {
                $("#confirmation_dialog .confirmation_dialog_message").text(gettext("A Due irá se atualizar e reiniciar o servidor."));
                $("#confirmation_dialog .confirmation_dialog_acknowledge").unbind("click");
                $("#confirmation_dialog .confirmation_dialog_acknowledge").click(function(e) {
                    e.preventDefault();
                    $("#confirmation_dialog").modal("hide");
                    self.performUpdate(force);
                });
                $("#confirmation_dialog").modal("show");
            }

        };

        self.onServerDisconnect = function() {
            if (self.restartTimeout !== undefined) {
                clearTimeout(self.restartTimeout);
            }
            return true;
        };

        self.onDataUpdaterReconnect = function() {
            if (self.waitingForRestart) {
                self.waitingForRestart = false;

                var options = {
                    title: gettext("Servidor iniciado!"),
                    text: gettext("A página será atualizada."),
                    type: "success",
                    hide: false
                };
                self._showPopup(options);
                self.updateInProgress = false;

                var delay = 5 + Math.floor(Math.random() * 5) + 1;
                setTimeout(function() {location.reload(true);}, delay * 1000);
            }
        };

        self.onDataUpdaterPluginMessage = function(plugin, data) {
            if (plugin != "softwareupdate") {
                return;
            }

            var messageType = data.type;
            var messageData = data.data;

            var options = undefined;

            switch (messageType) {
                case "updating": {
                    console.log(JSON.stringify(messageData));

                    var name = self.currentlyBeingUpdated[messageData.target];
                    if (name == octoprint) {
                        name = "Due Raster";
                    }

                    self._updatePopup({
                        text: _.sprintf(gettext("Atualizando %(name)s para %(version)s"), {name: name, version: messageData.version})
                    });
                    break;
                }
                case "restarting": {
                    console.log(JSON.stringify(messageData));

                    options = {
                        title: gettext("Atualização concluida!"),
                        text: gettext("A atualização foi concluida com sucesso, reiniciando a Due."),
                        type: "success",
                        hide: false,
                        buttons: {
                            sticker: false
                        }
                    };

                    self.waitingForRestart = true;
                    self.restartTimeout = setTimeout(function() {
                        self._showPopup({
                            title: gettext("Reinicio falhou"),
                            text: gettext("Não foi possível reiniciar a Due, espere 30 segundos e atualize a página!"),
                            type: "error",
                            hide: false,
                            buttons: {
                                sticker: false
                            }
                        });
                        self.waitingForRestart = false;
                    }, 20000);

                    break;
                }
                case "restart_manually": {
                    console.log(JSON.stringify(messageData));

                    var restartType = messageData.restart_type;
                    var text = gettext("Não foi possível reiniciar a Due, espere 30 segundos e atualize a página!");
                    if (restartType == "environment") {
                        text = gettext("Não foi possível reiniciar a Due, espere 30 segundos e atualize a página!");
                    }

                    options = {
                        title: gettext("Atualização concluida!"),
                        text: text,
                        type: "success",
                        hide: false,
                        buttons: {
                            sticker: false
                        }
                    };
                    self.updateInProgress = false;
                    break;
                }
                case "restart_failed": {
                    var restartType = messageData.restart_type;
                    var text = gettext("Não foi possível reiniciar a Due, espere 30 segundos e atualize a página!");
                    if (restartType == "environment") {
                        text = gettext("Não foi possível reiniciar a Due, espere 30 segundos e atualize a página!");
                    }

                    options = {
                        title: gettext("Reinicio falhou"),
                        test: gettext("Não foi possível reiniciar a Due, espere 30 segundos e atualize a página!"),
                        type: "error",
                        hide: false,
                        buttons: {
                            sticker: false
                        }
                    };
                    self.waitingForRestart = false;
                    self.updateInProgress = false;
                    break;
                }
                case "success": {
                    options = {
                        title: gettext("Atualização concluida!"),
                        text: gettext("Atualização concluida com sucesso!"),
                        type: "success",
                        hide: false,
                        buttons: {
                            sticker: false
                        }
                    };
                    self.updateInProgress = false;
                    break;
                }
                case "error": {
                    self._showPopup({
                        title: gettext("Atualização falhou!"),
                        text: gettext("Não foi possível atualizar, tente mais tarde"),
                        type: "error",
                        hide: false,
                        buttons: {
                            sticker: false
                        }
                    });
                    self.updateInProgress = false;
                    break;
                }
                case "update_versions": {
                    self.performCheck();
                    break;
                }
            }

            if (options != undefined) {
                self._showPopup(options);
            }
        };

    }

    // view model class, parameters for constructor, container to bind to
    ADDITIONAL_VIEWMODELS.push([SoftwareUpdateViewModel, ["loginStateViewModel", "printerStateViewModel", "settingsViewModel"], document.getElementById("settings_plugin_softwareupdate")]);
});
