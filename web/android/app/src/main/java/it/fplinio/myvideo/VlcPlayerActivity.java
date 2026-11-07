package it.fplinio.myvideo;

import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;
import java.util.Locale;

/** Lettore a schermo intero basato su libVLC (decodifica sul dispositivo, qualsiasi formato). */
public class VlcPlayerActivity extends AppCompatActivity {

    private LibVLC libVLC;
    private MediaPlayer player;
    private VLCVideoLayout videoLayout;
    private View controls;
    private View topBar;
    private SeekBar seek;
    private TextView timeText;
    private TextView playBtn;

    private long lengthMs = 0;
    private long timeMs = 0;
    private boolean dragging = false;
    private boolean ended = false;
    private String error = null;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable hide = this::hideControls;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        String url = getIntent().getStringExtra("url");
        String title = getIntent().getStringExtra("title");
        double startSec = getIntent().getDoubleExtra("position", 0);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        videoLayout = new VLCVideoLayout(this);
        root.addView(videoLayout, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        videoLayout.setOnClickListener(v -> toggleControls());

        // Barra superiore: indietro + titolo
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setBackgroundColor(0x99000000);
        top.setPadding(dp(12), dp(10), dp(12), dp(10));
        TextView back = text("←", 26);
        back.setOnClickListener(v -> finishWithResult());
        TextView titleView = text(title == null ? "" : title, 16);
        titleView.setSingleLine(true);
        titleView.setPadding(dp(14), 0, 0, 0);
        top.addView(back);
        top.addView(titleView);
        topBar = top;
        root.addView(top, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        // Barra inferiore: seek + comandi
        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setBackgroundColor(0x99000000);
        bottom.setPadding(dp(16), dp(8), dp(16), dp(12));

        LinearLayout seekRow = new LinearLayout(this);
        seekRow.setGravity(Gravity.CENTER_VERTICAL);
        seek = new SeekBar(this);
        seek.setMax(1000);
        timeText = text("0:00 / 0:00", 13);
        timeText.setPadding(dp(12), 0, 0, 0);
        seekRow.addView(seek, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        seekRow.addView(timeText);
        bottom.addView(seekRow);

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setGravity(Gravity.CENTER);
        TextView rew = text("⏪ 10", 18);
        playBtn = text("⏸", 28);
        TextView fwd = text("30 ⏩", 18);
        TextView audio = text("Audio", 14);
        TextView subs = text("Sottotitoli", 14);
        for (TextView t : new TextView[]{audio, rew, playBtn, fwd, subs}) {
            t.setPadding(dp(22), dp(6), dp(22), dp(6));
            btnRow.addView(t);
        }
        bottom.addView(btnRow);
        controls = bottom;
        root.addView(bottom, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));

        playBtn.setOnClickListener(v -> togglePlay());
        rew.setOnClickListener(v -> seekBy(-10000));
        fwd.setOnClickListener(v -> seekBy(30000));
        audio.setOnClickListener(v -> pickTrack(true));
        subs.setOnClickListener(v -> pickTrack(false));
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean fromUser) {
                if (fromUser && lengthMs > 0) timeText.setText(fmt(lengthMs * p / 1000) + " / " + fmt(lengthMs));
            }
            @Override public void onStartTrackingTouch(SeekBar s) { dragging = true; handler.removeCallbacks(hide); }
            @Override public void onStopTrackingTouch(SeekBar s) {
                dragging = false;
                if (player != null && lengthMs > 0) player.setTime(lengthMs * s.getProgress() / 1000);
                scheduleHide();
            }
        });

        goImmersive();
        if (url == null) { error = "URL mancante"; finishWithResult(); return; }

        ArrayList<String> args = new ArrayList<>();
        args.add("--network-caching=4000");
        args.add("--file-caching=4000");
        args.add("--http-reconnect");
        args.add("--no-drop-late-frames");
        args.add("--no-skip-frames");
        libVLC = new LibVLC(this, args);
        player = new MediaPlayer(libVLC);
        player.attachViews(videoLayout, null, false, false);

        Media media = new Media(libVLC, Uri.parse(url));
        media.setHWDecoderEnabled(true, false);
        if (startSec > 5) media.addOption(":start-time=" + startSec);
        player.setMedia(media);
        media.release();

        player.setEventListener(event -> {
            switch (event.type) {
                case MediaPlayer.Event.LengthChanged:
                    lengthMs = event.getLengthChanged();
                    break;
                case MediaPlayer.Event.TimeChanged:
                    timeMs = event.getTimeChanged();
                    if (!dragging) updateProgress();
                    break;
                case MediaPlayer.Event.Playing:
                    playBtn.setText("⏸");
                    break;
                case MediaPlayer.Event.Paused:
                    playBtn.setText("▶");
                    break;
                case MediaPlayer.Event.EndReached:
                    ended = true;
                    finishWithResult();
                    break;
                case MediaPlayer.Event.EncounteredError:
                    error = "Impossibile riprodurre questo file";
                    finishWithResult();
                    break;
                default:
                    break;
            }
        });
        player.play();
        scheduleHide();
    }

    private TextView text(String s, int sp) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(Color.WHITE);
        t.setTextSize(sp);
        return t;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    private static String fmt(long ms) {
        long s = Math.max(0, ms / 1000);
        long h = s / 3600, m = (s % 3600) / 60, sec = s % 60;
        return h > 0 ? String.format(Locale.US, "%d:%02d:%02d", h, m, sec) : String.format(Locale.US, "%d:%02d", m, sec);
    }

    private void updateProgress() {
        if (lengthMs > 0) seek.setProgress((int) (timeMs * 1000 / lengthMs));
        timeText.setText(fmt(timeMs) + " / " + fmt(lengthMs));
    }

    private void togglePlay() {
        if (player == null) return;
        if (player.isPlaying()) player.pause(); else player.play();
        scheduleHide();
    }

    private void seekBy(long deltaMs) {
        if (player == null) return;
        long target = Math.max(0, Math.min(lengthMs > 0 ? lengthMs - 1000 : Long.MAX_VALUE, player.getTime() + deltaMs));
        player.setTime(target);
        scheduleHide();
    }

    private void pickTrack(boolean audio) {
        if (player == null) return;
        MediaPlayer.TrackDescription[] tracks = audio ? player.getAudioTracks() : player.getSpuTracks();
        if (tracks == null || tracks.length == 0) return;
        int current = audio ? player.getAudioTrack() : player.getSpuTrack();
        String[] names = new String[tracks.length];
        int checked = 0;
        for (int i = 0; i < tracks.length; i++) {
            names[i] = tracks[i].name;
            if (tracks[i].id == current) checked = i;
        }
        handler.removeCallbacks(hide);
        new AlertDialog.Builder(this)
                .setTitle(audio ? "Traccia audio" : "Sottotitoli")
                .setSingleChoiceItems(names, checked, (d, which) -> {
                    if (audio) player.setAudioTrack(tracks[which].id); else player.setSpuTrack(tracks[which].id);
                    d.dismiss();
                    scheduleHide();
                })
                .setOnCancelListener(d -> scheduleHide())
                .show();
    }

    private void toggleControls() {
        if (controls.getVisibility() == View.VISIBLE) hideControls(); else { showControls(); scheduleHide(); }
    }

    private void showControls() {
        controls.setVisibility(View.VISIBLE);
        topBar.setVisibility(View.VISIBLE);
    }

    private void hideControls() {
        controls.setVisibility(View.GONE);
        topBar.setVisibility(View.GONE);
        goImmersive();
    }

    private void scheduleHide() {
        handler.removeCallbacks(hide);
        handler.postDelayed(hide, 4000);
    }

    private void goImmersive() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }

    private boolean finishing = false;

    private void finishWithResult() {
        if (finishing) return;
        finishing = true;
        Intent data = new Intent();
        if (error != null) {
            data.putExtra("error", error);
        } else {
            long pos = ended ? lengthMs : (player != null ? Math.max(timeMs, player.getTime()) : timeMs);
            data.putExtra("position", pos / 1000.0);
            data.putExtra("duration", lengthMs / 1000.0);
        }
        setResult(RESULT_OK, data);
        finish();
    }

    @Override
    public void onBackPressed() {
        finishWithResult();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null && player.isPlaying()) player.pause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(hide);
        final MediaPlayer p = player;
        final LibVLC l = libVLC;
        player = null;
        libVLC = null;
        if (p != null) {
            p.setEventListener(null);
            // il rilascio puo' bloccare: lo facciamo fuori dal thread UI
            new Thread(() -> {
                try { p.stop(); } catch (Throwable ignored) { }
                try { p.detachViews(); } catch (Throwable ignored) { }
                try { p.release(); } catch (Throwable ignored) { }
                if (l != null) try { l.release(); } catch (Throwable ignored) { }
            }).start();
        }
        super.onDestroy();
    }
}
