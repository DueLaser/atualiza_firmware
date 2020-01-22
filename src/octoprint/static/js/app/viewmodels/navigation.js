$(function() {
    function NavigationViewModel(parameters) {
        var self = this;

        self.loginState = parameters[0];
        self.appearance = parameters[1];
        self.settings = parameters[2];
        self.usersettings = parameters[3];

        self.systemActions = self.settings.system_actions;

        self.appearanceClasses = ko.computed(function() {
            var classes = self.appearance.color();
            if (self.appearance.colorTransparent()) {
                classes += " transparent";
            }
            return classes;
        });

        self.triggerAction = function(action) {
            var callback = function() {
                $.ajax({
                    url: API_BASEURL + "system",
                    type: "POST",
                    dataType: "json",
                    data: "action=" + action.action,
                    success: function() {
                        new PNotify({title: "Sucesso", text: _.sprintf(gettext("O comando \"%(command)s\" foi executado"), {command: action.name}), type: "success"});
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        if (!action.hasOwnProperty("ignore") || !action.ignore) {
                            var error = "<p>" + _.sprintf(gettext("O comando \"%(command)s\" não pode ser executado."), {command: action.name}) + "</p>";
                            error += pnotifyAdditionalInfo("<pre>" + jqXHR.responseText + "</pre>");
                            new PNotify({title: gettext("Erro"), text: error, type: "error", hide: false});
                        }
                    }
                })
            };
            if (action.confirm) {
                showConfirmationDialog(action.confirm, function (e) {
                    callback();
                });
            } else {
                callback();
            }
        }
    }

    OCTOPRINT_VIEWMODELS.push([
        NavigationViewModel,
        ["loginStateViewModel", "appearanceViewModel", "settingsViewModel", "userSettingsViewModel"],
        "#navbar"
    ]);
});
