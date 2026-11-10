package tech.vibelink.app;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * A notification that arrives while the app is open. (With the app closed or in the background Android shows it by itself, and a tap
 * starts MainActivity with the same "url".) Shown here so it looks and behaves the same either way.
 */
public class VibelinkMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        RemoteMessage.Notification n = message.getNotification();
        String title = n != null && n.getTitle() != null ? n.getTitle() : data.get("title");
        String body = n != null && n.getBody() != null ? n.getBody() : data.get("body");
        if (title == null && body == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;

        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("url", data.get("url"));
        int id = (int) (System.currentTimeMillis() & 0x7fffffff);
        PendingIntent tap = PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        MainActivity.createChannel(this);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, MainActivity.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_vibelink)
            .setColor(0xFF0F7A5F)
            .setContentTitle(title == null ? "Vibelink" : title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(tap);
        NotificationManagerCompat.from(this).notify(id, b.build());
    }

    /** Nothing to do: the page asks for the token again every time it loads, so a replaced one reaches the server on the next launch. */
    @Override
    public void onNewToken(String token) {}
}
