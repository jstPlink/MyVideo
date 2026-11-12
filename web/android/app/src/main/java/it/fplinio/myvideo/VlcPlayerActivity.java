package it.fplinio.myvideo;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONArray;
import org.json.JSONObject;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Lettore a schermo intero basato su libVLC con comandi in stile Netflix (colori dell'app: nero e rosso):
 *  - in alto: indietro, titolo (serie + episodio), formato schermo;
 *  - al centro: -10 s, play/pausa, +10 s;
 *  - in basso: barra rossa con tempo rimanente e riga con Blocca, Velocita', Episodi, Audio e sottotitoli, Prossimo;
 *  - gesti: luminosita' (sinistra), volume (destra), scorrimento orizzontale = cerca, doppio tocco = salta, tocco = mostra/nascondi i comandi (la pausa e' sul pulsante);
 *  - pulsante "Prossimo episodio" quando manca l'8% o meno alla fine.
 */
public class VlcPlayerActivity extends AppCompatActivity {

    private static final int RED = 0xFFE50914;
    /** Il pulsante "Prossimo episodio" compare quando manca meno di questa frazione della durata (8%). */
    private static final float NEXT_BUTTON_FRACTION = 0.08f;

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

    private static class Ep {
        int id;
        int season;
        int episode;
        String title;
        String seasonName;
    }

    private LibVLC libVLC;
    private MediaPlayer player;
    private VLCVideoLayout videoLayout;
    private FrameLayout rootView;
    private FrameLayout overlay;
    private SeekBar seek;
    private TextView timeText;
    private TextView lengthText;
    private ImageView playBtn;
    private TextView speedLabel;
    private TextView toast;
    private TextView nextBtn;
    private LinearLayout indicator;
    private ImageView indicatorIcon;
    private ProgressBar indicatorBar;
    private TextView indicatorText;
    private ImageView unlockBtn;

    private final List<Ep> episodes = new ArrayList<>();
    private int currentId = 0;
    private boolean hasNext = false;
    private boolean nextRequested = false;
    private int gotoId = 0;
    private boolean locked = false;
    private boolean overlayVisible = true;
    private boolean showRemaining = true;

    private float rate = 1f;
    private int scaleIdx = 0;

    private long lengthMs = 0;
    private long timeMs = 0;
    private boolean dragging = false;
    private boolean ended = false;
    private boolean finishing = false;
    private String error = null;

    // statistiche: secondi realmente guardati (solo in riproduzione, in primo piano)
    private final long startedAtWall = System.currentTimeMillis();
    private long watchedMs = 0;
    private long lastWatchTick = 0;
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
    private final Runnable hide = () -> hideOverlay(false);
    private final Runnable hideToast = () -> { if (toast != null) toast.setVisibility(View.GONE); };
    private final Runnable hideIndicator = () -> { if (indicator != null) indicator.setVisibility(View.GONE); };
    private final Runnable hideUnlock = () -> { if (unlockBtn != null) unlockBtn.setVisibility(View.GONE); };

    private final Runnable watchTick = new Runnable() {
        @Override public void run() {
            accumulateWatch();
            handler.postDelayed(this, 1000);
        }
    };

    private void accumulateWatch() {
        long now = SystemClock.elapsedRealtime();
        if (player != null && lastWatchTick > 0 && player.isPlaying()) watchedMs += now - lastWatchTick;
        lastWatchTick = now;
    }

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
        String seriesTitle = getIntent().getStringExtra("seriesTitle");
        double startSec = getIntent().getDoubleExtra("position", 0);
        hasNext = getIntent().getBooleanExtra("hasNext", false);
        currentId = getIntent().getIntExtra("currentId", 0);
        parseEpisodes(getIntent().getStringExtra("episodes"));

        // "Serie S1:E3 - Titolo" -> titolo serie + dettaglio episodio
        String mainTitle = title == null ? "" : title;
        String subTitle = "";
        if (seriesTitle != null && !seriesTitle.isEmpty() && mainTitle.startsWith(seriesTitle)) {
            subTitle = mainTitle.substring(seriesTitle.length()).trim();
            mainTitle = seriesTitle;
        }

        FrameLayout root = new FrameLayout(this);
        rootView = root;
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        videoLayout = new VLCVideoLayout(this);
        root.addView(videoLayout, match());

        // ---- strato dei gesti
        View touchLayer = new View(this);
        root.addView(touchLayer, match());
        gestures = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent e) { return true; }

            @Override public boolean onSingleTapConfirmed(MotionEvent e) {
                if (locked) { showUnlockButton(); return true; }
                toggleOverlay();
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

        // ---- overlay dei comandi
        overlay = new FrameLayout(this);
        root.addView(overlay, match());

        // barra superiore: indietro, titolo, formato schermo
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setBackground(gradient(true));
        top.setPadding(dp(10), dp(10), dp(10), dp(26));
        ImageView back = icon(R.drawable.ic_pl_back, 26);
        back.setOnClickListener(v -> { if (!locked) finishWithResult(); });
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        TextView titleView = text(mainTitle, 18);
        titleView.setTypeface(titleView.getTypeface(), Typeface.BOLD);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titles.addView(titleView);
        if (!subTitle.isEmpty()) {
            TextView sub = text(subTitle, 13);
            sub.setTextColor(0xFFCCCCCC);
            sub.setSingleLine(true);
            sub.setEllipsize(TextUtils.TruncateAt.END);
            titles.addView(sub);
        }
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tl.setMargins(dp(6), 0, dp(6), 0);
        ImageView aspect = icon(R.drawable.ic_pl_aspect, 24);
        aspect.setOnClickListener(v -> cycleScale());
        top.addView(back);
        top.addView(titles, tl);
        top.addView(aspect);
        overlay.addView(top, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        // centro: -10, play/pausa, +10
        LinearLayout center = new LinearLayout(this);
        center.setGravity(Gravity.CENTER);
        FrameLayout rew = iconLabel(R.drawable.ic_pl_rew, "10", 46);
        playBtn = icon(R.drawable.ic_pl_pause, 64);
        FrameLayout fwd = iconLabel(R.drawable.ic_pl_fwd, "10", 46);
        for (View v : new View[]{rew, playBtn, fwd}) {
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            p.setMargins(dp(26), 0, dp(26), 0);
            center.addView(v, p);
        }
        overlay.addView(center, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        // basso: barra rossa + riga di pulsanti
        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setBackground(gradient(false));
        bottom.setPadding(dp(22), dp(36), dp(22), dp(8));

        LinearLayout seekRow = new LinearLayout(this);
        seekRow.setGravity(Gravity.CENTER_VERTICAL);
        timeText = text("0:00", 13);
        lengthText = text("0:00", 13);
        lengthText.setMinWidth(dp(56));
        lengthText.setGravity(Gravity.END);
        lengthText.setOnClickListener(v -> { showRemaining = !showRemaining; updateProgress(); });
        seek = new SeekBar(this);
        seek.setMax(1000);
        seek.setProgressTintList(ColorStateList.valueOf(RED));
        seek.setThumbTintList(ColorStateList.valueOf(RED));
        seek.setProgressBackgroundTintList(ColorStateList.valueOf(0x66FFFFFF));
        seekRow.addView(timeText);
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        sl.setMargins(dp(6), 0, dp(6), 0);
        seekRow.addView(seek, sl);
        seekRow.addView(lengthText);
        bottom.addView(seekRow);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setGravity(Gravity.CENTER);
        buttons.setPadding(0, dp(2), 0, 0);
        View lockBtn = labeled(R.drawable.ic_pl_lock, "Blocca");
        View speedBtn = labeled(R.drawable.ic_pl_speed, "Velocità 1x");
        speedLabel = (TextView) ((LinearLayout) speedBtn).getChildAt(1);
        View epsBtn = labeled(R.drawable.ic_pl_episodes, "Episodi");
        View tracksBtn = labeled(R.drawable.ic_pl_subs, "Audio e sottotitoli");
        View nextRowBtn = labeled(R.drawable.ic_pl_next, "Prossimo ep.");
        List<View> row = new ArrayList<>();
        row.add(lockBtn);
        row.add(speedBtn);
        if (!episodes.isEmpty()) row.add(epsBtn);
        row.add(tracksBtn);
        if (hasNext) row.add(nextRowBtn);
        for (View v : row) {
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            buttons.addView(v, p);
        }
        bottom.addView(buttons);
        overlay.addView(bottom, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));

        // ---- pulsante "Prossimo episodio" (compare all'8% finale)
        nextBtn = text("⏭  Prossimo episodio", 16);
        nextBtn.setTypeface(nextBtn.getTypeface(), Typeface.BOLD);
        GradientDrawable nb = new GradientDrawable();
        nb.setColor(0xE6141414);
        nb.setStroke(dp(1), 0x99FFFFFF);
        nb.setCornerRadius(dp(6));
        nextBtn.setBackground(nb);
        nextBtn.setPadding(dp(20), dp(12), dp(20), dp(12));
        nextBtn.setVisibility(View.GONE);
        FrameLayout.LayoutParams nl = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.END);
        nl.rightMargin = dp(24);
        nl.bottomMargin = dp(120);
        root.addView(nextBtn, nl);

        // ---- messaggi e indicatori
        toast = text("", 22);
        toast.setBackground(round(0xB0000000));
        toast.setPadding(dp(20), dp(10), dp(20), dp(10));
        toast.setVisibility(View.GONE);
        root.addView(toast, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER | Gravity.TOP));
        ((FrameLayout.LayoutParams) toast.getLayoutParams()).topMargin = dp(80);

        indicator = new LinearLayout(this);
        indicator.setOrientation(LinearLayout.HORIZONTAL);
        indicator.setGravity(Gravity.CENTER_VERTICAL);
        indicator.setBackground(round(0xB0000000));
        indicator.setPadding(dp(14), dp(10), dp(18), dp(10));
        indicatorIcon = icon(R.drawable.ic_pl_volume, 24);
        indicatorIcon.setClickable(false);
        indicatorBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        indicatorBar.setMax(100);
        indicatorBar.setProgressTintList(ColorStateList.valueOf(RED));
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
        fwd.setOnClickListener(v -> { seekBy(10000); flash("+10 s"); });
        lockBtn.setOnClickListener(v -> setLocked(true));
        speedBtn.setOnClickListener(v -> pickSpeed());
        epsBtn.setOnClickListener(v -> showEpisodes());
        tracksBtn.setOnClickListener(v -> showTracks());
        nextRowBtn.setOnClickListener(v -> requestNext());
        nextBtn.setOnClickListener(v -> requestNext());
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
        lastWatchTick = SystemClock.elapsedRealtime();
        handler.postDelayed(watchTick, 1000);
        handler.postDelayed(endWatch, 2000);
        scheduleHide();
    }

    // ---------------------------------------------------------------- dati

    private void parseEpisodes(String json) {
        if (json == null || json.isEmpty()) return;
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                Ep e = new Ep();
                e.id = o.getInt("id");
                e.season = o.optInt("season", 1);
                e.episode = o.isNull("episode") ? 0 : o.optInt("episode", 0);
                e.title = o.isNull("title") ? null : o.optString("title", null);
                e.seasonName = o.optString("seasonName", "Stagione " + e.season);
                episodes.add(e);
            }
        } catch (Exception ignored) {
            episodes.clear();
        }
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

    private void ripple(View v) {
        TypedValue out = new TypedValue();
        if (getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, out, true)) v.setBackgroundResource(out.resourceId);
    }

    private ImageView icon(int res, int sizeDp) {
        ImageView v = new ImageView(this);
        v.setImageResource(res);
        int pad = dp(10);
        v.setPadding(pad, pad, pad, pad);
        v.setLayoutParams(new ViewGroup.LayoutParams(dp(sizeDp) + 2 * pad, dp(sizeDp) + 2 * pad));
        v.setScaleType(ImageView.ScaleType.FIT_CENTER);
        ripple(v);
        v.setClickable(true);
        return v;
    }

    /** Icona con piccola etichetta numerica al centro (es. 10). */
    private FrameLayout iconLabel(int res, String label, int sizeDp) {
        FrameLayout f = new FrameLayout(this);
        ImageView v = icon(res, sizeDp);
        v.setClickable(false);
        v.setBackground(null);
        f.addView(v);
        TextView t = text(label, 11);
        t.setTypeface(t.getTypeface(), Typeface.BOLD);
        t.setShadowLayer(0, 0, 0, 0);
        f.addView(t, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        f.setClickable(true);
        ripple(f);
        return f;
    }

    /** Pulsante con icona sopra e testo sotto (riga inferiore, come Netflix). */
    private LinearLayout labeled(int res, String label) {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER_HORIZONTAL);
        l.setPadding(dp(4), dp(2), dp(4), dp(2));
        ImageView i = new ImageView(this);
        i.setImageResource(res);
        l.addView(i, new LinearLayout.LayoutParams(dp(26), dp(26)));
        TextView t = text(label, 12);
        t.setGravity(Gravity.CENTER);
        t.setSingleLine(true);
        t.setEllipsize(TextUtils.TruncateAt.END);
        l.addView(t);
        l.setClickable(true);
        ripple(l);
        return l;
    }

    private GradientDrawable gradient(boolean fromTop) {
        return new GradientDrawable(fromTop ? GradientDrawable.Orientation.TOP_BOTTOM : GradientDrawable.Orientation.BOTTOM_TOP,
                new int[]{0xDD000000, 0x00000000});
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
        long remaining = lengthMs - timeMs;
        boolean near = hasNext && lengthMs > 0 && remaining > 0 && remaining <= lengthMs * NEXT_BUTTON_FRACTION;
        nextBtn.setVisibility(near && !locked ? View.VISIBLE : View.GONE);
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

    private void requestNext() {
        if (!hasNext) return;
        nextRequested = true;
        finishWithResult();
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

    private static String rateLabel(float r) {
        return (r == (int) r ? String.valueOf((int) r) : String.valueOf(r)) + "x";
    }

    private void pickSpeed() {
        if (player == null) return;
        String[] names = new String[RATES.length];
        int checked = 0;
        for (int i = 0; i < RATES.length; i++) {
            names[i] = RATES[i] == 1f ? "Normale" : rateLabel(RATES[i]);
            if (RATES[i] == rate) checked = i;
        }
        handler.removeCallbacks(hide);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Velocità di riproduzione")
                .setSingleChoiceItems(names, checked, (d, which) -> {
                    rate = RATES[which];
                    player.setRate(rate);
                    speedLabel.setText("Velocità " + rateLabel(rate));
                    d.dismiss();
                    scheduleHide();
                })
                .setOnCancelListener(d -> scheduleHide())
                .show();
    }

    // ---------------------------------------------------------------- episodi

    private void showEpisodes() {
        if (episodes.isEmpty()) return;
        final List<Integer> seasons = new ArrayList<>();
        final List<String> seasonNames = new ArrayList<>();
        int currentSeason = episodes.get(0).season;
        for (Ep e : episodes) {
            if (!seasons.contains(e.season)) { seasons.add(e.season); seasonNames.add(e.seasonName); }
            if (e.id == currentId) currentSeason = e.season;
        }

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(8), dp(16), 0);
        final ListView list = new ListView(this);
        final Spinner spinner = new Spinner(this);
        final AlertDialog[] dialogRef = new AlertDialog[1];
        final List<Ep> shown = new ArrayList<>();

        if (seasons.size() > 1) {
            spinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, seasonNames));
            box.addView(spinner, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
        box.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(300)));

        final int[] cur = {currentSeason};
        Runnable fill = () -> {
            shown.clear();
            List<String> labels = new ArrayList<>();
            int checked = -1;
            for (Ep e : episodes) {
                if (e.season != cur[0]) continue;
                if (e.id == currentId) checked = shown.size();
                shown.add(e);
                String num = e.episode > 0 ? e.episode + "   " : "";
                labels.add(num + (e.title != null && !e.title.isEmpty() ? e.title : "Episodio " + (e.episode > 0 ? e.episode : "")) + (e.id == currentId ? "   ▶" : ""));
            }
            list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_single_choice, labels));
            list.setChoiceMode(ListView.CHOICE_MODE_SINGLE);
            if (checked >= 0) { list.setItemChecked(checked, true); list.setSelection(Math.max(0, checked - 2)); }
        };
        fill.run();
        if (seasons.size() > 1) {
            spinner.setSelection(Math.max(0, seasons.indexOf(currentSeason)));
            spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                    if (seasons.get(position) != cur[0]) { cur[0] = seasons.get(position); fill.run(); }
                }
                @Override public void onNothingSelected(AdapterView<?> parent) { }
            });
        }
        list.setOnItemClickListener((parent, view, position, id) -> {
            Ep e = shown.get(position);
            if (dialogRef[0] != null) dialogRef[0].dismiss();
            if (e.id != currentId) { gotoId = e.id; finishWithResult(); } else scheduleHide();
        });

        handler.removeCallbacks(hide);
        dialogRef[0] = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Episodi")
                .setView(box)
                .setNegativeButton("Chiudi", null)
                .setOnDismissListener(d -> scheduleHide())
                .create();
        dialogRef[0].show();
    }

    // ---------------------------------------------------------------- audio e sottotitoli

    private LinearLayout trackColumn(String heading, MediaPlayer.TrackDescription[] tracks, int current, boolean audioTrack) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        TextView h = text(heading, 16);
        h.setTypeface(h.getTypeface(), Typeface.BOLD);
        h.setShadowLayer(0, 0, 0, 0);
        h.setPadding(dp(8), 0, 0, dp(6));
        col.addView(h);
        if (tracks == null || tracks.length == 0) {
            TextView none = text("Non disponibile", 14);
            none.setTextColor(0xFF9A9A9A);
            none.setShadowLayer(0, 0, 0, 0);
            none.setPadding(dp(8), dp(4), 0, 0);
            col.addView(none);
            return col;
        }
        ScrollView sv = new ScrollView(this);
        RadioGroup rg = new RadioGroup(this);
        for (MediaPlayer.TrackDescription t : tracks) {
            RadioButton rb = new RadioButton(this);
            rb.setId(View.generateViewId());
            rb.setText(t.name);
            rb.setTextColor(Color.WHITE);
            rb.setButtonTintList(ColorStateList.valueOf(RED));
            rb.setTag(t.id);
            rb.setChecked(t.id == current);
            rg.addView(rb);
        }
        rg.setOnCheckedChangeListener((group, checkedId) -> {
            View v = group.findViewById(checkedId);
            if (v == null || player == null) return;
            int id = (Integer) v.getTag();
            if (audioTrack) player.setAudioTrack(id); else player.setSpuTrack(id);
        });
        sv.addView(rg);
        col.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(220)));
        return col;
    }

    private void showTracks() {
        if (player == null) return;
        MediaPlayer.TrackDescription[] a = player.getAudioTracks();
        MediaPlayer.TrackDescription[] s = player.getSpuTracks();
        LinearLayout cols = new LinearLayout(this);
        cols.setOrientation(LinearLayout.HORIZONTAL);
        cols.setPadding(dp(16), dp(8), dp(16), 0);
        cols.addView(trackColumn("Audio", a, player.getAudioTrack(), true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        cols.addView(trackColumn("Sottotitoli", s, player.getSpuTrack(), false), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        handler.removeCallbacks(hide);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Audio e sottotitoli")
                .setView(cols)
                .setPositiveButton("Chiudi", null)
                .setOnDismissListener(d -> scheduleHide())
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

    /** Tocco sullo schermo: mostra i comandi oppure li nasconde (come l'app Netflix). */
    private void toggleOverlay() {
        if (overlayVisible) {
            handler.removeCallbacks(hide);
            hideOverlay(true);
        } else {
            showOverlay();
        }
    }

    private void hideOverlay(boolean force) {
        if (!force && player != null && !player.isPlaying()) return;
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
            nextBtn.setVisibility(View.GONE);
            flash("Comandi bloccati");
            showUnlockButton();
        } else {
            unlockBtn.setVisibility(View.GONE);
            flash("Comandi sbloccati");
            showOverlay();
            updateProgress();
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
            data.putExtra("goto", gotoId);
            accumulateWatch();
            data.putExtra("watched", watchedMs / 1000.0);
            data.putExtra("startedAt", startedAtWall);
            data.putExtra("endedAt", System.currentTimeMillis());
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
