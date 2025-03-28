const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const Cvc = imports.gi.Cvc;
const Slider = imports.ui.slider;
const Tooltips = imports.ui.tooltips;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const { get_home_dir,
  file_test,
  FileTest
} = imports.gi.GLib; //GLib

const APPNAME = "Radio3.0";
const UUID = APPNAME + "@claudiux";

const HOME_DIR = get_home_dir();
const APPLET_DIR = HOME_DIR + "/.local/share/cinnamon/applets/" + UUID;
const DEBUG_FILE = APPLET_DIR + "/DEBUG";

const ENABLED_EXTENSIONS_KEY = "enabled-extensions";
const EXTENSION_UUID = "OSD150@claudiux";

const IS_OSD150_ENABLED = () => {
    var enabled = false;
    const enabledExtensions = global.settings.get_strv(ENABLED_EXTENSIONS_KEY);
    for (let i = 0; i < enabledExtensions.length; i++) {
        if (enabledExtensions[i] == EXTENSION_UUID) {
            enabled = true;
            break;
        }
    }
    return enabled;
}

/**
 * DEBUG:
 * Returns whether or not the DEBUG file is present in this applet directory ($ touch DEBUG)
 * Used by the log function above.
 */

function DEBUG() {
  return file_test(DEBUG_FILE, FileTest.EXISTS);
};

/**
 * Usage of log and logError:
 * log("Any message here") to log the message only if DEBUG() returns true.
 * log("Any message here", true) to log the message even if DEBUG() returns false.
 * logError("Any error message") to log the error message regardless of the DEBUG() return.
 */
function log(message, alwaysLog=false) {
  if (DEBUG() || alwaysLog) Main._logInfo("[" + UUID + "]: " + message);
}

function logDebug(message) {
  log(message, true)
}

function logError(error) {
  global.logError("\n[" + UUID + "]: " + error + "\n")
}

function version_exceeds(version, min_version) {
  let our_version = version.split(".");
  let cmp_version = min_version.split(".");
  let i;

  for (i = 0; i < our_version.length && i < cmp_version.length; i++) {
    let our_part = parseInt(our_version[i]);
    let cmp_part = parseInt(cmp_version[i]);

    if (isNaN(our_part) || isNaN(cmp_part)) {
      return false;
    }

    if (our_part < cmp_part) {
      return false;
    } else
    if (our_part > cmp_part) {
      return true;
    }
  }

  if (our_version.length < cmp_version.length) {
    return false;
  } else {
    return true;
  }
}

const CINNAMON_VERSION = ""+GLib.getenv("CINNAMON_VERSION");
const IS_AT_LEAST_CINNAMON6DOT4 = version_exceeds(CINNAMON_VERSION, "6.4");

/**
 * Class VolumeSlider
 */
class VolumeSlider extends PopupMenu.PopupSliderMenuItem {
    constructor(applet, stream, tooltip, app_icon = null) {

        super(applet.percentage);
        this.applet = applet;

        //this.last_now = Date.now();

        if(tooltip)
            this.tooltipText = tooltip + ": ";
        else
            this.tooltipText = "";

        this.tooltip = new Tooltips.Tooltip(this.actor, this.tooltipText);

        this.connectId = this.connect("value-changed", () => this._onValueChanged());

        this.app_icon = app_icon;
        if (this.app_icon == null) {
            this.iconName = "audio-volume-muted";
            this.icon = new St.Icon({icon_name: this.iconName, icon_type: St.IconType.SYMBOLIC, icon_size: 16});
        }
        else {
            this.icon = new St.Icon({icon_name: this.app_icon, icon_type: St.IconType.FULLCOLOR, icon_size: 16});
        }

        this.removeActor(this._slider);
        this.addActor(this.icon, {span: 0});
        this.addActor(this._slider, {span: -1, expand: true});

        let percentage = this.applet.get_volume_at_startup();

        this.connectWithStream(stream);

        this.stream.volume = percentage/100 * (this.isOutputSink ? this.applet._volumeMax : this.applet._volumeNorm);
        this.stream.push_volume();
    }

    connectWithStream(stream) {
        if (!stream) {
            this.actor.hide();
            this.stream = null;
        } else {
            this.actor.show();
            this.stream = stream;
            this.isOutputSink = stream instanceof Cvc.MixerSink;

            let mutedId = stream.connect("notify::is-muted", () => this._update());
            let volumeId = stream.connect("notify::volume", () => this._update());
            this.connect("destroy", () => {
                stream.disconnect(mutedId);
                stream.disconnect(volumeId);
                stream.remove_monitor();
            });
        }

        this._update();
    }

    _onValueChanged() {
        if (!this.stream) return;

        let muted;
        // Use the scaled volume max only for the main output
        let volume = this._value * (this.isOutputSink ? this.applet._volumeMax : this.applet._volumeNorm);

        if(this._value < 0.005) {
            volume = 0;
            muted = true;
        } else {
            muted = false;
            let semi_volume_step = this.applet.volume_step / 200;
            //100% is magnetic:
            if (volume != this.applet._volumeNorm && volume > this.applet._volumeNorm*(1-semi_volume_step) && volume < this.applet._volumeNorm*(1+semi_volume_step))
                volume = this.applet._volumeNorm;
        }
        this.applet.percentage = parseInt(volume/this.applet._volumeNorm*100);
        this.stream.volume = volume;
        this.stream.push_volume();

        if(this.stream.is_muted !== muted)
            this.stream.change_is_muted(muted);

        if (this.applet.showOSD) {
            let iconName = this._volumeToIcon(1.0*this.applet.percentage/100, "audio-volume-webradioreceiver-")+"-symbolic";
            let icon = Gio.Icon.new_for_string(iconName);
            try {
                let _percentage_str = ""+this.applet.percentage;
                if (this.applet.show_percent)
                    _percentage_str += _("%");
                if (IS_AT_LEAST_CINNAMON6DOT4) {
                    if (IS_OSD150_ENABLED())
                        Main.osdWindowManager.show(-1, icon, _percentage_str, parseInt(this.applet.percentage), 1, this.applet.OSDhorizontal);
                    else
                        Main.osdWindowManager.show(-1, icon, _percentage_str, parseInt(this.applet.percentage));
                } else {
                    Main.osdWindowManager.show(-1, icon, _percentage_str, null);
                }
            } catch (e) {
                // Do nothing
            }
        }
        this.applet.showOSD = this.applet.volume_show_osd;

        //~ if(!this._dragging)
            //~ this.applet._notifyVolumeChange(this.stream);
    }

    _onScrollEvent(actor, event) {
        //log("VolumeSlider: _onScrollEvent");
        // FIXME! This is only a workaround to avoid multiple change of volume.
        //~ let now = Date.now();
        //~ if (now - this.last_now < 20) {
            //~ this.last_now = now;
            //~ return;
        //~ }
        //~ this.last_now = now;

        let direction = event.get_scroll_direction();
        let step = this.applet.volume_step/100/this.applet._volumeMax*this.applet._volumeNorm;

        if (direction == Clutter.ScrollDirection.DOWN) {
            this._value = Math.max(0, this._value - step);
        }
        else if (direction == Clutter.ScrollDirection.UP) {
            this._value = Math.min(1, this._value + step);
        }

        this._slider.queue_repaint();
        //this.tooltip.show();
        this.emit('value-changed', this._value);
    }

    _onKeyPressEvent(actor, event) {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Right || key === Clutter.KEY_Left) {
            let step = this.applet.volume_step/100/this.applet._volumeMax*this.applet._volumeNorm;
            let delta = key === Clutter.KEY_Right ? step : -step;
            if (St.Widget.get_default_direction() === St.TextDirection.RTL)
                delta = -delta;

            this._value = Math.max(0, Math.min(this._value + delta/this.applet._volumeMax*this.applet._volumeNorm, 1));
            this._slider.queue_repaint();
            this.emit('value-changed', this._value);
            this.emit('drag-end');
            return true;
        }
        return false;
    }


    _update() {
        // value: percentage of volume_max (set as value in the widget)
        // visible_value: percentage of volume_norm (shown to the user)
        // these only differ for the output, and only when the user changes the maximum volume
        let volume = (!this.stream || this.stream.is_muted) ? 0 : this.stream.volume;
        var value, visible_value;
        let delta = this.applet.volume_step/100*this.applet._volumeMax/this.applet._volumeNorm;

        visible_value = volume / this.applet._volumeNorm;
        if (this.applet.magnetic25On) {
            for (let i = 0.25; i <= 1; i+=0.25) {
                if (visible_value != i && visible_value > (i - delta / 2) && visible_value < (i + delta / 2)) {
                    visible_value = i;
                    //~ value = i*this.applet._volumeNorm;
                    break;
                }
            }
        }
        if (visible_value > 1) { // This should never happen.
            logDebug("Volume > 100%: "+visible_value*100+"%");
            visible_value = 1;
        }
        value = visible_value;

        this.percentage = Math.round(visible_value * 100);
        if (this.percentage !== this.applet.percentage)
          this.applet.percentage = this.percentage;

        this.tooltip.set_text(this.tooltipText + this.percentage + "%");
        //~ this.applet.change_volume_in_radio_tooltip();
        this.applet.set_radio_tooltip_to_default_one();
        if (this._dragging)
            this.tooltip.show();

        let iconName = this._volumeToIcon(value);
        if (this.app_icon == null) {
            this.icon.icon_name = iconName;
        }

        this.setValue(value);

        // send data to applet
        this.emit("values-changed", iconName, this.percentage);
    }

    _volumeToIcon(value, basename="audio-volume-") {
        //~ log("VolumeSlider: _volumeToIcon", true);
        //~ log("value: "+value, true);
        let icon;
        if(value < 0.005) {
            icon = "muted";
        } else {
            let n = Math.floor(3 * value);
            if(n < 1)
                icon = "low";
            else if(n < 2)
                icon = "medium";
            else
                icon = "high";
        }
        return basename + icon;
    }
}

/**
 * Class StreamMenuSection
 */
class StreamMenuSection extends PopupMenu.PopupMenuSection {
    constructor(applet, stream) {
        //log("VolumeSlider: StreamMenuSection constructor");
        super();

        let iconName = stream.icon_name;
        let name = stream.name;

        // capitalize the stream name
        if (name.length > 2) {
            //name = name.charAt(0).toUpperCase() + name.slice(1);
            name = name.slice(0, 3).toUpperCase() + name.slice(3);
        }

        // Trim stream name
        if(name.length > 20) {
            name = name.substring(0, 16) + "... ";
        }

        // Special cases
        if(name === "Banshee") {
            iconName = "banshee";
        }
        else if (name === "Spotify") {
            iconName = "spotify";
        }
        if(name === "VBox") {
            name = "Virtualbox";
            iconName = "virtualbox";
        }
        else if (iconName === "audio") {
            iconName = "audio-x-generic";
        }

        //this.slider = new VolumeSlider(applet, stream, name, iconName);
        this.slider = new VolumeSlider(applet, stream, name, null);
        this.addMenuItem(this.slider);
    }
}
