package it.fplinio.myvideo;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
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

/**
 * Lettore a schermo intero basato su libVLC, con interfaccia ispirata a VLC per Android:
 * barra superiore (indietro, titolo, audio, sottotitoli, velocita'), barra inferiore (tempo, seekbar arancione,
 * blocco, precedente/successivo, -10/+30, play/pausa, formato schermo) e gesti
 * (luminosita' a sinistra, volume a destra, scorrimento orizzontale = cerca, doppio tocco = salta, tocco = pausa).
 */
public class VlcPlayerActivity extends AppCompatActivity {

    private static final int ORANGE = 0xFFFF8800;

    private static final float[] RATES = {0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f};
    private static final MediaPlayer.ScaleType[] SCALES = {
            MediaPlayer.ScaleType.SURFACE_BEST_FIT,
            MediaPlayer.ScaleType.SURFACE_FIT_SCREEN,
            MediaPlayer.ScaleType.SURFACE_FILL,
            MediaPlayer.ScaleType.SURFACE_16_9,
            MediaPlayer.ScaleType.SURFACE_4_3,
            MediaPlayer.ScaleType.SURFACE_ORIGINAL,
    };
    private static final String[] SCALE_NAMES = {"Adatta", "Schermo intero", "Riempi", "16:9", "4:3", "Originale"};

    private LibVLC libVLC;
    private MediaPlayer player;
    private VLCVideoLayout videoLayout;
    private FrameLayout rootView;
    private FrameLayout overlay;
    private SeekBar seek;
    private TextView timeText;
    private TextView lengthText;
    private ImageView playBtn;
    private TextView speedBtn;
    private TextView toast;
    private LinearLayout indicator;
    private ImageView indicatorIcon;
    private ProgressBar indicatorBar;
    private TextView indicatorText;
    private ImageView unlockBtn;

    private boolean hasNext = false;
    private boolean hasPrev = false;
    private boolean nextRequested = false;
    private boolean prevRequested = false;
    private boolean locked = false;
    private boolean overlayVisible = true;
    private boolean showRemaining = false;

    private float rate = 1f;
    private int scaleIdx = 0;

    private long lengthMs = 0;
    private long timeMs = 0;
    private boolean dragging = false;
    private boolean ended = false;
    private boolean finishing = false;
    private String error = null;
    private long lastTickTime = -1;
    private int stalledTicks = 0;

    // gesti
    private GestureDetector gestures;
    private int scrollMode = 0; // 0 nessuno, 1 cerca, 2 luminosita', 3 volume
    private long seekStartMs = 0;
    private long seekTargetMs = 0;
    private float brightnessStart = 0.5f;
    private int volumeStart = 0;
    private AudioManager audio;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable hide = this::hideOverlay;
    private final Runnable hideToast = () -> { if (toast != null) toast.setVisibility(View.GONE); };
    private final Runnable hideIndicator = () -> { if (indicator != null) indicator.setVisibility(View.GONE); };
    private final Runnable hideUnlock = () -> { if (unlockBtn != null) unlockBtn.setVisibility(View.GONE); };

    /**
     * libVLC non sempre invia EndReached (file con durata dichiarata errata, flussi HTTP che si chiudono):
     * ogni secondo controlliamo stato e tempo. Se il lettore e' Ended/Stopped/Error vicino alla fine, o il tempo
     * non avanza da 4 s negli ultimi 45 s di video, l'episodio e' considerato finito.
     */
    private final Runnable endWatch = new Runnable() {
        @Override public void run() {
            if (player == null || finishing) return;
            try {
                long len = Math.max(lengthMs, player.getLength());
                long t = Math.max(timeMs, player.getTime());
                int st = player.getPlayerState();
                boolean nearEnd = len > 0 && t >= len - 45000;
                boolean veryNear = len > 0 && t >= len - 3000;
                boolean terminal = st == Media.State.Ended || st == Media.State.Stopped || st == Media.State.Error;
                if (terminal && (veryNear || st == Media.State.Ended)) {
                    ended = true;
                    finishWithResult();
                    return;
                }
                boolean paused = st == Media.State.Paused;
                if (nearEnd && !paused && t == lastTickTime) stalledTicks++; else stalledTicks = 0;
                lastTickTime = t;
                if (stalledTicks >= 4) {
                    ended = true;
                    finishWithResult();
                    return;
                }
            } catch (Throwable ignored) { /* il lettore sta per essere rilasciato */ }
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);

        String url = getIntent().getStringExtra("url");
        String title = getIntent().getStringExtra("title");
        double startSec = getIntent().getDoubleExtra("position", 0);
        hasNext = getIntent().getBooleanExtra("hasNext", false);
        hasPrev = getIntent().getBooleanExtra("hasPrev", false);

        FrameLayout root = new FrameLayout(this);
        rootView = root;
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        videoLayout = new VLCVideoLayout(this);
        root.addView(videoLayout, match());

        // Strato dei gesti
        View touchLayer = new View(this);
        root.addView(touchLayer, match());
        gestures = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent e) { return true; }

            @Override public boolean onSingleTapConfirmed(MotionEvent e) {
                if (locked) { showUnlockButton(); return true; }
                togglePlay();
                showOverlay();
                return true;
            }

            @Override public boolean onDoubleTap(MotionEvent e) {
                if (locked) return true;
                boolean right = e.getX() > rootView.getWidth() / 2f;
                seekBy(right ? 30000 : -10000);
                flash(right ? "+30 s" : "-10 s");
                return true;
            }

            @Override public boolean onScroll(MotionEvent e1, MotionEvent e2, float dx, float dy) {
                if (locked || e1 == null || player == null) return false;
                float totX = e2.getX() - e1.getX();
                float totY = e2.getY() - e1.getY();
                if (scrollMode == 0) {
                    if (Math.abs(totX) < dp(14) && Math.abs(totY) < dp(14)) return true;
                    if (Math.abs(totX) > Math.abs(totY)) {
                        scrollMode = 1;
                        seekStartMs = player.getTime();
                        seekTargetMs = seekStartMs;
                    } else if (e1.getX() < rootView.getWidth() / 2f) {
                        scrollMode = 2;
                        brightnessStart = currentBrightness();
                    } else {
                        scrollMode = 3;
                        volumeStart = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
                    }
                }
                float h = Math.max(1, rootView.getHeight()) * 0.75f;
                if (scrollMode == 1) {
                    long delta = (long) (totX / Math.max(1, rootView.getWidth()) * 90000f);
                    long max = lengthMs > 0 ? lengthMs - 1000 : Long.MAX_VALUE;
                    seekTargetMs = Math.max(0, Math.min(max, seekStartMs + delta));
                    long diff = seekTargetMs - seekStartMs;
                    flashKeep((diff >= 0 ? "+" : "-") + fmt(Math.abs(diff)) + "  (" + fmt(seekTargetMs) + ")");
                } else if (scrollMode == 2) {
                    float b = Math.max(0.02f, Math.min(1f, brightnessStart - totY / h));
                    WindowManager.LayoutParams lp = getWindow().getAttributes();
                    lp.screenBrightness = b;
                    getWindow().setAttributes(lp);
                    showIndicator(R.drawable.ic_pl_brightness, (int) (b * 100));
                } else if (scrollMode == 3) {
                    int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                    float v = Math.max(0f, Math.min(max, volumeStart - totY / h * max));
                    audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(v), 0);
                    showIndicator(R.drawable.ic_pl_volume, Math.round(v * 100f / max));
                }
                return true;
            }
        });
        touchLayer.setOnTouchListener((v, ev) -> {
            gestures.onTouchEvent(ev);
            int a = ev.getActionMasked();
            if (a == MotionEvent.ACTION_UP || a == MotionEvent.ACTION_CANCEL) endScroll();
            return true;
        });

        // Overlay dei comandi
        overlay = new FrameLayout(this);
        root.addView(overlay, match());

        // ---- barra superiore
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setBackground(gradient(true));
        top.setPadding(dp(8), dp(8), dp(8), dp(22));
        ImageView back = icon(R.drawable.ic_pl_back, 26);
        back.setOnClickListener(v -> { if (!locked) finishWithResult(); });
        TextView titleView = text(title == null ? "" : title, 16);
        titleView.setSingleLine(true);
        titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tl.setMargins(dp(6), 0, dp(6), 0);
        ImageView audioBtn = icon(R.drawable.ic_pl_audio, 24);
        ImageView subsBtn = icon(R.drawable.ic_pl_subs, 24);
        speedBtn = text("1x", 15);
        speedBtn.setTypeface(speedBtn.getTypeface(), android.graphics.Typeface.BOLD);
        speedBtn.setPadding(dp(12), dp(8), dp(12), dp(8));
        top.addView(back);
        top.addView(titleView, tl);
        top.addView(audioBtn);
        top.addView(subsBtn);
        top.addView(speedBtn);
        overlay.addView(top, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        // ---- barra inferiore
        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setBackground(gradient(false));
        bottom.setPadding(dp(18), dp(28), dp(18), dp(10));

        LinearLayout seekRow = new LinearLayout(this);
        seekRow.setGravity(Gravity.CENTER_VERTICAL);
        timeText = text("0:00", 13);
        lengthText = text("0:00", 13);
        lengthText.setOnClickListener(v -> { showRemaining = !showRemaining; updateProgress(); });
        seek = new SeekBar(this);
        seek.setMax(1000);
        seek.setProgressTintList(ColorStateList.valueOf(ORANGE));
        seek.setThumbTintList(ColorStateList.valueOf(ORANGE));
        seek.setProgressBackgroundTintList(ColorStateList.valueOf(0x66FFFFFF));
        seekRow.addView(timeText);
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        sl.setMargins(dp(6), 0, dp(6), 0);
        seekRow.addView(seek, sl);
        seekRow.addView(lengthText);
        bottom.addView(seekRow);

        FrameLayout btnRow = new FrameLayout(this);
        btnRow.setPadding(0, dp(4), 0, 0);
        ImageView lockBtn = icon(R.drawable.ic_pl_lock, 24);
        btnRow.addView(lockBtn, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.START | Gravity.CENTER_VERTICAL));

        LinearLayout center = new LinearLayout(this);
        center.setGravity(Gravity.CENTER);
        ImageView prev = icon(R.drawable.ic_pl_prev, 30);
        prev.setAlpha(hasPrev ? 1f : 0.3f);
        FrameLayout rew = iconLabel(R.drawable.ic_pl_rew, "10");
        playBtn = icon(R.drawable.ic_pl_pause, 44);
        FrameLayout fwd = iconLabel(R.drawable.ic_pl_fwd, "30");
        ImageView next = icon(R.drawable.ic_pl_next, 30);
        next.setAlpha(hasNext ? 1f : 0.3f);
        for (View v : new View[]{prev, rew, playBtn, fwd, next}) {
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            p.setMargins(dp(10), 0, dp(10), 0);
            center.addView(v, p);
        }
        btnRow.addView(center, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        ImageView aspect = icon(R.drawable.ic_pl_aspect, 24);
        btnRow.addView(aspect, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.END | Gravity.CENTER_VERTICAL));
        bottom.addView(btnRow);
        overlay.addView(bottom, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));

        // ---- messaggi e indicatori
        toast = text("", 22);
        toast.setBackground(round(0xB0000000));
        toast.setPadding(dp(20), dp(10), dp(20), dp(10));
        toast.setVisibility(View.GONE);
        root.addView(toast, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        indicator = new LinearLayout(this);
        indicator.setOrientation(LinearLayout.HORIZONTAL);
        indicator.setGravity(Gravity.CENTER_VERTICAL);
        indicator.setBackground(round(0xB0000000));
        indicator.setPadding(dp(14), dp(10), dp(18), dp(10));
        indicatorIcon = icon(R.drawable.ic_pl_volume, 24);
        indicatorIcon.setClickable(false);
        indicatorBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        indicatorBar.setMax(100);
        indicatorBar.setProgressTintList(ColorStateList.valueOf(ORANGE));
        indicatorText = text("0%", 15);
        indicator.addView(indicatorIcon);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(dp(140), ViewGroup.LayoutParams.WRAP_CONTENT);
        bl.setMargins(dp(8), 0, dp(10), 0);
        indicator.addView(indicatorBar, bl);
        indicator.addView(indicatorText);
        indicator.setVisibility(View.GONE);
        FrameLayout.LayoutParams il = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        il.topMargin = dp(40);
        root.addView(indicator, il);

        unlockBtn = icon(R.drawable.ic_pl_unlock, 28);
        unlockBtn.setBackground(round(0xB0000000));
        unlockBtn.setVisibility(View.GONE);
        FrameLayout.LayoutParams ul = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.START | Gravity.CENTER_VERTICAL);
        ul.leftMargin = dp(24);
        root.addView(unlockBtn, ul);
        unlockBtn.setOnClickListener(v -> setLocked(false));

        // ---- azioni
        playBtn.setOnClickListener(v -> togglePlay());
        rew.setOnClickListener(v -> { seekBy(-10000); flash("-10 s"); });
        fwd.setOnClickListener(v -> { seekBy(30000); flash("+30 s"); });
        prev.setOnClickListener(v -> { if (hasPrev) { prevRequested = true; finishWithResult(); } });
        next.setOnClickListener(v -> { if (hasNext) { nextRequested = true; finishWithResult(); } });
        lockBtn.setOnClickListener(v -> setLocked(true));
        aspect.setOnClickListener(v -> cycleScale());
        audioBtn.setOnClickListener(v -> pickTrack(true));
        subsBtn.setOnClickListener(v -> pickTrack(false));
        speedBtn.setOnClickListener(v -> pickSpeed());
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean fromUser) {
                if (fromUser && lengthMs > 0) timeText.setText(fmt(lengthMs * p / 1000));
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
                    playBtn.setImageResource(R.drawable.ic_pl_pause);
                    break;
                case MediaPlayer.Event.Paused:
                    playBtn.setImageResource(R.drawable.ic_pl_play);
                    break;
                case MediaPlayer.Event.EndReached:
                    ended = true;
                    finishWithResult();
                    break;
                case MediaPlayer.Event.Stopped:
                    if (lengthMs > 0 && timeMs >= lengthMs - 3000 && !finishing) {
                        ended = true;
                        finishWithResult();
                    }
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
        handler.postDelayed(endWatch, 2000);
        scheduleHide();
    }

    // ---------------------------------------------------------------- costruzione interfaccia

    private FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private TextView text(String s, int sp) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setShadowLayer(4f, 0, 1f, 0x99000000);
        return t;
    }

    private ImageView icon(int res, int sizeDp) {
        ImageView v = new ImageView(this);
        v.setImageResource(res);
        int pad = dp(10);
        v.setPadding(pad, pad, pad, pad);
        v.setLayoutParams(new ViewGroup.LayoutParams(dp(sizeDp) + 2 * pad, dp(sizeDp) + 2 * pad));
        v.setScaleType(ImageView.ScaleType.FIT_CENTER);
        TypedValue out = new TypedValue();
        if (getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, out, true)) v.setBackgroundResource(out.resourceId);
        v.setClickable(true);
        return v;
    }

    /** Icona con piccola etichetta numerica al centro (es. 10 / 30). */
    private FrameLayout iconLabel(int res, String label) {
        FrameLayout f = new FrameLayout(this);
        ImageView v = icon(res, 30);
        v.setClickable(false);
        v.setBackground(null);
        f.addView(v);
        TextView t = text(label, 9);
        t.setShadowLayer(0, 0, 0, 0);
        f.addView(t, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        f.setClickable(true);
        TypedValue out = new TypedValue();
        if (getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, out, true)) f.setBackgroundResource(out.resourceId);
        return f;
    }

    private GradientDrawable gradient(boolean fromTop) {
        return new GradientDrawable(fromTop ? GradientDrawable.Orientation.TOP_BOTTOM : GradientDrawable.Orientation.BOTTOM_TOP,
                new int[]{0xCC000000, 0x00000000});
    }

    private GradientDrawable round(int color) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(24));
        return g;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    private static String fmt(long ms) {
        long s = Math.max(0, ms / 1000);
        long h = s / 3600, m = (s % 3600) / 60, sec = s % 60;
        return h > 0 ? String.format(Locale.US, "%d:%02d:%02d", h, m, sec) : String.format(Locale.US, "%d:%02d", m, sec);
    }

    // ---------------------------------------------------------------- stato e comandi

    private void updateProgress() {
        if (lengthMs > 0) seek.setProgress((int) (timeMs * 1000 / lengthMs));
        timeText.setText(fmt(timeMs));
        lengthText.setText(showRemaining ? "-" + fmt(Math.max(0, lengthMs - timeMs)) : fmt(lengthMs));
    }

    private void togglePlay() {
        if (player == null) return;
        if (player.isPlaying()) {
            player.pause();
            handler.removeCallbacks(hide); // in pausa i comandi restano visibili
        } else {
            player.play();
            scheduleHide();
        }
    }

    private void seekBy(long deltaMs) {
        if (player == null) return;
        long target = Math.max(0, Math.min(lengthMs > 0 ? lengthMs - 1000 : Long.MAX_VALUE, player.getTime() + deltaMs));
        player.setTime(target);
        timeMs = target;
        updateProgress();
    }

    private void endScroll() {
        if (scrollMode == 1 && player != null) {
            player.setTime(seekTargetMs);
            timeMs = seekTargetMs;
            updateProgress();
            handler.removeCallbacks(hideToast);
            handler.postDelayed(hideToast, 500);
        }
        if (scrollMode == 2 || scrollMode == 3) {
            handler.removeCallbacks(hideIndicator);
            handler.postDelayed(hideIndicator, 700);
        }
        scrollMode = 0;
    }

    private float currentBrightness() {
        float b = getWindow().getAttributes().screenBrightness;
        if (b < 0) {
            try {
                b = Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS) / 255f;
            } catch (Exception e) {
                b = 0.5f;
            }
        }
        return b;
    }

    private void showIndicator(int iconRes, int percent) {
        indicatorIcon.setImageResource(iconRes);
        indicatorBar.setProgress(percent);
        indicatorText.setText(percent + "%");
        indicator.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideIndicator);
    }

    private void flash(String msg) {
        flashKeep(msg);
        handler.postDelayed(hideToast, 800);
    }

    private void flashKeep(String msg) {
        toast.setText(msg);
        toast.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideToast);
    }

    private void cycleScale() {
        if (player == null) return;
        scaleIdx = (scaleIdx + 1) % SCALES.length;
        player.setVideoScale(SCALES[scaleIdx]);
        flash(SCALE_NAMES[scaleIdx]);
        scheduleHide();
    }

    private void pickSpeed() {
        if (player == null) return;
        String[] names = new String[RATES.length];
        int checked = 0;
        for (int i = 0; i < RATES.length; i++) {
            names[i] = rateLabel(RATES[i]);
            if (RATES[i] == rate) checked = i;
        }
        handler.removeCallbacks(hide);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Velocità di riproduzione")
                .setSingleChoiceItems(names, checked, (d, which) -> {
                    rate = RATES[which];
                    player.setRate(rate);
                    speedBtn.setText(rateLabel(rate));
                    d.dismiss();
                    scheduleHide();
                })
                .setOnCancelListener(d -> scheduleHide())
                .show();
    }

    private static String rateLabel(float r) {
        return (r == (int) r ? String.valueOf((int) r) : String.valueOf(r)) + "x";
    }

    private void pickTrack(boolean audioTrack) {
        if (player == null) return;
        MediaPlayer.TrackDescription[] tracks = audioTrack ? player.getAudioTracks() : player.getSpuTracks();
        if (tracks == null || tracks.length == 0) {
            flash(audioTrack ? "Nessuna traccia audio" : "Nessun sottotitolo");
            return;
        }
        int current = audioTrack ? player.getAudioTrack() : player.getSpuTrack();
        String[] names = new String[tracks.length];
        int checked = 0;
        for (int i = 0; i < tracks.length; i++) {
            names[i] = tracks[i].name;
            if (tracks[i].id == current) checked = i;
        }
        handler.removeCallbacks(hide);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(audioTrack ? "Traccia audio" : "Sottotitoli")
                .setSingleChoiceItems(names, checked, (d, which) -> {
                    if (audioTrack) player.setAudioTrack(tracks[which].id); else player.setSpuTrack(tracks[which].id);
                    d.dismiss();
                    scheduleHide();
                })
                .setOnCancelListener(d -> scheduleHide())
                .show();
    }

    // ---------------------------------------------------------------- overlay e blocco

    private void showOverlay() {
        if (locked) return;
        overlayVisible = true;
        overlay.setVisibility(View.VISIBLE);
        overlay.animate().alpha(1f).setDuration(150).start();
        if (player != null && player.isPlaying()) scheduleHide();
    }

    private void hideOverlay() {
        if (player != null && !player.isPlaying()) return;
        overlayVisible = false;
        overlay.animate().alpha(0f).setDuration(200).withEndAction(() -> { if (!overlayVisible) overlay.setVisibility(View.GONE); }).start();
        goImmersive();
    }

    private void scheduleHide() {
        handler.removeCallbacks(hide);
        handler.postDelayed(hide, 4000);
    }

    private void setLocked(boolean lock) {
        locked = lock;
        if (lock) {
            handler.removeCallbacks(hide);
            overlayVisible = false;
            overlay.setVisibility(View.GONE);
            flash("Comandi bloccati");
            showUnlockButton();
        } else {
            unlockBtn.setVisibility(View.GONE);
            flash("Comandi sbloccati");
            showOverlay();
        }
    }

    private void showUnlockButton() {
        unlockBtn.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideUnlock);
        handler.postDelayed(hideUnlock, 2500);
    }

    private void goImmersive() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }

    // ---------------------------------------------------------------- chiusura

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
            data.putExtra("next", nextRequested);
            data.putExtra("prev", prevRequested);
        }
        setResult(RESULT_OK, data);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (locked) { showUnlockButton(); flash("Sblocca i comandi per uscire"); return; }
        finishWithResult();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null && player.isPlaying()) player.pause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
        getWindow().setAttributes(lp);
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
