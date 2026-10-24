package io.github.torgh.tripdeck;

import android.content.res.Configuration;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        matchSystemBars(getResources().getConfiguration());
    }

    // The activity is not recreated when the phone switches between light and dark (uiMode is in
    // configChanges), so the clock and battery icons would keep the old theme's colour.
    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        matchSystemBars(config);
    }

    /** Dark icons on the light theme, light icons on the dark one. */
    private void matchSystemBars(Configuration config) {
        boolean dark = (config.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(!dark);
        bars.setAppearanceLightNavigationBars(!dark);
    }
}
