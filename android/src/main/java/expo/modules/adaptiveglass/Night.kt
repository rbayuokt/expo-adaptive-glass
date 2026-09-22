package expo.modules.adaptiveglass

import android.content.res.Configuration
import expo.modules.kotlin.views.ExpoView

// JS sends the resolved scheme. The fallback reads the activity: an app-level switch
// (AppCompat night mode) updates its configuration, not the one a view's own resources hold
fun ExpoView.isNight(scheme: String): Boolean = when (scheme) {
  "dark" -> true
  "light" -> false
  else -> {
    val config = appContext.currentActivity?.resources?.configuration ?: resources.configuration
    (config.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
  }
}
