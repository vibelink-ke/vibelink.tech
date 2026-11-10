package tech.vibelink.app;

import android.Manifest;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * The shell around a company's Vibelink site, plus the two things a web view cannot do by itself:
 *
 *  - notifications: the phone registers with Firebase, the page hands the token to the server once someone has signed in, and a tapped
 *    notification opens the page it names;
 *  - downloads: files the server sends go to the Downloads folder through the system's download manager, and files the page makes
 *    itself (exports, the Winbox profile) are passed here by the page and written to Downloads.
 *
 * The page talks to this through window.VibelinkNative, driven by res/raw/vl_shim.js, which is run on every page of a Vibelink site.
 * Capacitor's own bridge is only present on the app's built-in pages, never on the site, which is why this does not use it.
 */
public class MainActivity extends BridgeActivity {

    static final String CHANNEL = "alerts";
    private static final String[] ROOTS = { "vibelink.tech", "vibelink.co.ke" };   // the same list as capacitor.config.json
    private static final String PREFS = "vibelink";
    private static final int ASK_NOTIFICATIONS = 4101;

    /** The page on screen, kept for the checks below: the methods the page calls run off the main thread, where the web view cannot be asked. */
    private volatile String pageUrl = "";
    private String shim = "";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createChannel(this);
        shim = readShim();

        final WebView web = getBridge().getWebView();
        web.addJavascriptInterface(new NativeApi(), "VibelinkNative");

        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            String name = URLUtil.guessFileName(url, disposition, mime);
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                // Only the page can read these: it fetches the file and passes it to saveFile.
                js("window.__vlSaveUrl&&window.__vlSaveUrl(" + JSONObject.quote(url) + "," + JSONObject.quote(name) + ")");
                return;
            }
            try {
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);    // the file is behind the same sign-in as the page
                if (cookie != null) r.addRequestHeader("Cookie", cookie);
                if (userAgent != null) r.addRequestHeader("User-Agent", userAgent);
                if (mime != null && !mime.isEmpty()) r.setMimeType(mime);
                r.setTitle(name);
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                else r.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
                toast("Downloading " + name);
            } catch (Exception e) {
                toast("Could not download " + name);
            }
        });

        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView v) {
                pageUrl = String.valueOf(v.getUrl());
            }

            @Override
            public void onPageLoaded(WebView v) {
                pageUrl = String.valueOf(v.getUrl());
                String host = ourHost(pageUrl);
                if (host == null) return;
                // Remembered so a tapped notification can open straight on this company's site.
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("site", host).apply();
                v.evaluateJavascript(shim, null);
            }
        });
    }

    /** A tapped notification carries the page to open ("url", a path on the company's site). Also called once at start-up. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String path = intent == null ? null : intent.getStringExtra("url");
        if (path == null || !path.startsWith("/") || path.startsWith("//")) return;
        intent.removeExtra("url");
        String site = getSharedPreferences(PREFS, MODE_PRIVATE).getString("site", null);
        if (site == null || ourHost("https://" + site + "/") == null || getBridge() == null) return;
        final WebView web = getBridge().getWebView();
        web.post(() -> web.loadUrl("https://" + site + path));
    }

    /** The host of a URL when it is a Vibelink site over https, otherwise null. */
    static String ourHost(String url) {
        try {
            Uri u = Uri.parse(url);
            String host = u.getHost();
            if (host == null || !"https".equals(u.getScheme())) return null;
            host = host.toLowerCase();
            for (String root : ROOTS) if (host.equals(root) || host.endsWith("." + root)) return host;
        } catch (Exception ignored) { /* not a URL */ }
        return null;
    }

    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Alerts", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Routers going down, jobs assigned to you, payments that need attention");
        c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    private void js(String code) {
        final WebView web = getBridge().getWebView();
        web.post(() -> web.evaluateJavascript(code, null));
    }

    private void toast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show());
    }

    private String readShim() {
        try (InputStream in = getResources().openRawResource(R.raw.vl_shim); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    private boolean firebaseReady() {
        return !FirebaseApp.getApps(this).isEmpty();   // empty when the app was built without google-services.json
    }

    /** What the page may ask of the phone. Every method does nothing unless the page on screen is a Vibelink site. */
    private class NativeApi {

        private boolean allowed() {
            return ourHost(pageUrl) != null;
        }

        @JavascriptInterface
        public boolean pushReady() {
            return allowed() && firebaseReady();
        }

        /** Hands this phone's Firebase token to the page (window.__vlPush), which sends it to the server with its own sign-in. */
        @JavascriptInterface
        public void pushToken() {
            if (!pushReady()) return;
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener((task) -> {
                if (task.isSuccessful() && task.getResult() != null) {
                    js("window.__vlPush&&window.__vlPush(" + JSONObject.quote(task.getResult()) + ")");
                }
            });
        }

        /** Android 13 and later show nothing until the person agrees: asked once someone has signed in, not at first launch. */
        @JavascriptInterface
        public void askNotifications() {
            if (!allowed() || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
            runOnUiThread(() -> {
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(MainActivity.this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFICATIONS);
                }
            });
        }

        /** A file the page made itself, as base64: written to the Downloads folder. */
        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            if (!allowed() || base64 == null) return;
            final String safe = String.valueOf(name == null || name.trim().isEmpty() ? "download" : name).replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            new Thread(() -> {
                try {
                    byte[] data = Base64.decode(base64, Base64.DEFAULT);
                    String type = mime;
                    if (type == null || type.isEmpty()) {
                        int dot = safe.lastIndexOf('.');
                        type = dot < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(safe.substring(dot + 1).toLowerCase());
                    }
                    if (type == null || type.isEmpty()) type = "application/octet-stream";
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        ContentValues v = new ContentValues();
                        v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                        v.put(MediaStore.Downloads.MIME_TYPE, type);
                        v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                        v.put(MediaStore.Downloads.IS_PENDING, 1);
                        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                        if (uri == null) throw new IllegalStateException("no place to save");
                        try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                            out.write(data);
                        }
                        v.clear();
                        v.put(MediaStore.Downloads.IS_PENDING, 0);
                        getContentResolver().update(uri, v, null, null);
                        toast("Saved to Downloads: " + safe);
                    } else {
                        // Before Android 10 the shared Downloads folder needs a storage permission; the app's own folder does not.
                        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                        File file = new File(dir, safe);
                        try (OutputStream out = new FileOutputStream(file)) {
                            out.write(data);
                        }
                        toast("Saved: " + file.getAbsolutePath());
                    }
                } catch (Exception e) {
                    toast("Could not save " + safe);
                }
            }).start();
        }
    }
}
