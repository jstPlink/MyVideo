package it.fplinio.myvideo;

import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ponte tra la web app e il lettore nativo libVLC.
 * play({ url, title, position }) apre il lettore a schermo intero e risolve alla chiusura
 * con { position, duration } in secondi.
 */
@CapacitorPlugin(name = "VlcPlayer")
public class VlcPlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL mancante");
            return;
        }
        Intent intent = new Intent(getContext(), VlcPlayerActivity.class);
        intent.putExtra("url", url);
        intent.putExtra("title", call.getString("title", ""));
        intent.putExtra("position", call.getDouble("position", 0.0));
        intent.putExtra("hasNext", Boolean.TRUE.equals(call.getBoolean("hasNext", false)));
        intent.putExtra("hasPrev", Boolean.TRUE.equals(call.getBoolean("hasPrev", false)));
        startActivityForResult(call, intent, "playResult");
    }

    @ActivityCallback
    private void playResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (data != null && data.hasExtra("error")) {
            call.reject(data.getStringExtra("error"));
            return;
        }
        JSObject ret = new JSObject();
        ret.put("position", data != null ? data.getDoubleExtra("position", 0) : 0);
        ret.put("duration", data != null ? data.getDoubleExtra("duration", 0) : 0);
        ret.put("next", data != null && data.getBooleanExtra("next", false));
        ret.put("prev", data != null && data.getBooleanExtra("prev", false));
        call.resolve(ret);
    }
}
