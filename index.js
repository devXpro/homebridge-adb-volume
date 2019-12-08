var Service, Characteristic;
    exec = require('child_process').exec;
    execSync = require('child_process').execSync;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-adb-volume", "adb-volume", ADBController);
}

function puts(error, stdout, stderr) {
    console.log(stdout);
    console.log(stderr);
}

function ADBController(log, config) {
    this.log = log;
    this.currentVolume = 0;
    this.muted = false;
    this.name = config.name || 'ADBController';
    this.volumeDisable = config['volumeDisable'] || false;
    this.volumeName = config['volumeName'] || "Receiver Volume";
    this.maxVolume = config['maxVolume'] || 15;
    this.host = config['host'];
    this.useFan = !!config['useFan']; // default to false, and make sure its a bool
    this.volumeBeforeMute = 3;
    this.starters = config['starters'] || false;
    if (!this.host) {
        this.log.warn('Config is missing host/IP of receiver');
        callback(new Error('No host/IP defined.'));
        return;
    }
    //TODO: Call it sync
    exec('adb connect '+ this.host, puts);
}

ADBController.prototype.getStatus = function(callback) {
    var command = "adb shell dumpsys audio | grep -A 4 STREAM_TTS |"+
        " grep speaker | cut -d')' -f2 | cut -d' ' -f2| cut -d',' -f1";
    exec(command, function(error, stdout, stderr) {
        if (stderr) {
            callback(null);
        } else {
            callback(parseInt(stdout.trim()));
        }
    });
}

ADBController.prototype.setVolume = function(value, callback) {
    this.log('Current = '+ this.currentVolume + ' Setted = ' + value);
    if (value !== this.currentVolume) {
        exec('adb shell service call audio 7 i32 3 i32 ' + value + ' i32 1', function(error, stdout, stderr) {
            if (stderr) {
                this.log('Error = ' + stderr);
                callback(error);
            } else {
                this.log('Volume was changed on android...');
                this.currentVolume = value;
                callback(null);
            }
        }.bind(this));
    } else {
        callback(null);
    }
};

ADBController.prototype.setBrightness = function(newLevel, callback) {
    var onePercent = this.maxVolume / 100;
    var relativeVolume = Math.round(onePercent * newLevel);
    this.setVolume(relativeVolume, callback);
}

ADBController.prototype.getBrightness = function(callback) {
    this.getStatus(function(status) {
        if (status) {
            var oneStep = 100 / this.maxVolume;
            callback(null, Math.round(oneStep * status));
        } else {
            this.log('Unable to get receiver status');
            callback(null);
        }

    }.bind(this));
};

ADBController.prototype.getPowerOn = function(callback) {
    this.getStatus(function(status) {
        var powerState = status ? 1 : 0;
        callback(null, powerState);
    }.bind(this));
}

ADBController.prototype.setPowerOn = function(powerOn, callback) {
    if (powerOn) {
        if (this.muted) {
            this.log('Power On');
            this.muted = false;
            this.setVolume(this.volumeBeforeMute, callback);
        } else {
            callback(null);
        }
    } else {
        this.log('Power Off');
        this.log('Current volume: ' + this.currentVolume + ' Volume before Mute: ' + this.volumeBeforeMute);
        this.volumeBeforeMute = this.currentVolume;
        this.muted = true;
        this.setVolume(0, callback);
    }
};

ADBController.prototype.setPowerState = function(targetService, powerState, callback, context) {
    var funcContext = 'fromSetPowerState';

    // Callback safety
    if (context == funcContext) {
        if (callback) {
            callback();
        }

        return;
    }
    this.services.forEach(function (switchService, idx) {
        if (idx === 0 && !this.volumeDisable) {
            // Don't check the VolumeService which is at idx=0
            return;
        }

        if (targetService.subtype === switchService.subtype) {
            if(powerState){
                this.androidPower(true, callback);
                var starterIndex = this.volumeDisable ? idx : idx - 1;
                if (this.starters[starterIndex]['command']) {
                    var commands = this.starters[starterIndex]['command'].split(' ');
                    commands.forEach(function(keycode){
                        execSync('adb shell input keyevent ' + keycode);
                    });
                }
            } else{
                this.androidPower(false, callback);
            }
        } else {
            switchService.getCharacteristic(Characteristic.On).setValue(false, undefined, funcContext);
            callback(null);
        }
    }.bind(this));
}

ADBController.prototype.androidPower = function(powerOn, callback) {
    var command = 'adb shell dumpsys power | grep \'mHoldingDisplaySuspendBlocker\'';
    exec(command, function(error, stdout, stderr) {
        var searchElement = powerOn ? 'false' : 'true';
        if (stdout.indexOf(searchElement) !== -1) {
            exec('adb shell input keyevent 26', puts);
        }
    });
}

ADBController.prototype.getServices = function() {
   this.services = [];
   if(!this.volumeDisable) {
       var lightbulbService = this.useFan ? new Service.Fan(this.volumeName) : new Service.Lightbulb(this.volumeName);

       lightbulbService.getCharacteristic(Characteristic.On).
           on('get', this.getPowerOn.bind(this)).
           on('set', this.setPowerOn.bind(this));
       if (this.useFan) {
           lightbulbService.addCharacteristic(new Characteristic.RotationSpeed()).
               on('get', this.getBrightness.bind(this)).
               on('set', this.setBrightness.bind(this));
       } else {
           lightbulbService.addCharacteristic(new Characteristic.Brightness()).
               on('get', this.getBrightness.bind(this)).
               on('set', this.setBrightness.bind(this));
       }
       this.services.push(lightbulbService);
   }
    if (this.starters) {
        this.starters.forEach(function(starter) {
            var switchService = new Service.Switch(starter.name, starter.name);
            switchService
                .getCharacteristic(Characteristic.On)
                .on('set', this.setPowerState.bind(this, switchService));

            this.services.push(switchService);
        }.bind(this));
    }
    return this.services;
}





