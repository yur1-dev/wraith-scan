package farm.wraith.app;

import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Google refuses to show its sign-in page inside an app window. Open it in an in-app sheet (Chrome Custom Tab)
        // instead of the full browser, the same way other apps do. Everything else behaves as before.
        bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String host = url.getHost() == null ? "" : url.getHost();
                if (host.equals("accounts.google.com") || host.endsWith(".accounts.google.com")) {
                    CustomTabsIntent tab = new CustomTabsIntent.Builder()
                        .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder()
                            .setToolbarColor(Color.parseColor("#0C0C0D")).build())
                        .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
                        .setShowTitle(true)
                        .build();
                    tab.launchUrl(MainActivity.this, url);
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
    }
}
