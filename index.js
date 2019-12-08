var Service, Characteristic;
    exec = require('child_process').exec;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-adb-volume", "adb-volume", ReceiverVolume);
}

function puts(error, stdout, stderr) {
    console.log(stdout);
    console.log(stderr);
}

function ReceiverVolume(log, config) {
    this.log = log;
    this.currentVolume = 0;
    this.name = config['name'] || "Receiver Volume";
    this.maxVolume = config['maxVolume'] || 15;
    this.host = config['host'];
    this.useFan = !!config['useFan']; // default to false, and make sure its a bool
    this.volumeBeforeMute = 3;
    if (!this.host) {
        this.log.warn('Config is missing host/IP of receiver');
        callback(new Error('No host/IP defined.'));
        return;
    }
    //TODO: Call it sync
    exec('adb connect '+ this.host, puts);
}

ReceiverVolume.prototype.getStatus = function(callback) {
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

ReceiverVolume.prototype.setVolume = function(value, callback) {
    this.log('Current = '+ this.currentVolume + 'Setted = ' + value);
    if (value !== this.currentVolume) {
        exec('adb shell service call audio 7 i32 3 i32 ' + value + ' i32 1', function(error, stdout, stderr) {
            if (stderr) {
                this.log('Error = ' + stderr);
                callback(error);
            } else {
                this.log('non Error');
                this.currentVolume = value;
                callback(null);
            }
        }.bind(this));
    } else {
        callback(null);
    }
};

ReceiverVolume.prototype.setBrightness = function(newLevel, callback) {
    var onePercent = this.maxVolume / 100;
    var relativeVolume = Math.round(onePercent * newLevel);
    this.setVolume(relativeVolume, callback);
}

ReceiverVolume.prototype.getBrightness = function(callback) {
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

ReceiverVolume.prototype.getPowerOn = function(callback) {
    this.getStatus(function(status) {
        var powerState = status ? 1 : 0;
        callback(null, powerState);
    }.bind(this));
}

ReceiverVolume.prototype.setPowerOn = function(powerOn, callback) {
    if (powerOn) {
        this.log('Power On');
        this.setVolume(this.volumeBeforeMute, callback);
        callback(null);
    } else {
        this.log('Power Off');
        this.log('Current volume: ' + this.currentVolume + ' Volume before Mute: ' + this.volumeBeforeMute);
        this.volumeBeforeMute = this.currentVolume;
        this.setVolume(0, callback);
    }
};

ReceiverVolume.prototype.getServices = function() {
    var lightbulbService = this.useFan ? new Service.Fan(this.name) : new Service.Lightbulb(this.name);

    lightbulbService
        .getCharacteristic(Characteristic.On)
        .on('get', this.getPowerOn.bind(this))
        .on('set', this.setPowerOn.bind(this));
    if (this.useFan) {
        lightbulbService
            .addCharacteristic(new Characteristic.RotationSpeed())
            .on('get', this.getBrightness.bind(this))
            .on('set', this.setBrightness.bind(this));
    }
    else {
        lightbulbService
            .addCharacteristic(new Characteristic.Brightness())
            .on('get', this.getBrightness.bind(this))
            .on('set', this.setBrightness.bind(this));
    }
    return [lightbulbService];
}
