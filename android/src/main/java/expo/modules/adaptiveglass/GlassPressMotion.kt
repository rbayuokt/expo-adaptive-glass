package expo.modules.adaptiveglass

import android.graphics.Matrix
import android.os.Build
import android.view.View
import kotlin.math.abs
import kotlin.math.min

// Applied through View.setAnimationMatrix so RN's own transform props are never touched.
class GlassPressMotion(private val view: View, private val onFrame: () -> Unit) {
  // scaleX, scaleY, translateX (dp), translateY (dp), press 0..1
  private val springs = SpringSet(view, 5) {
    apply()
    onFrame()
  }.also { s -> REST.forEachIndexed { i, v -> s.snap(i, v) } }
  private val matrix = Matrix()
  private val density = view.resources.displayMetrics.density

  val press: Float
    get() = springs.value[4]

  // out = scaleX, scaleY, translateX px, translateY px
  fun current(out: FloatArray) {
    val v = springs.value
    out[0] = v[0]
    out[1] = v[1]
    out[2] = v[2] * density
    out[3] = v[3] * density
  }

  fun pressTo(dx: Float, dy: Float) {
    val size = maxOf(view.width, view.height, 1) / density
    // cap the growth in dp so large cards don't balloon
    val grow = min(0.08f, 12f / size)
    val ex = min(1f, abs(dx / density) / 60f)
    val ey = min(1f, abs(dy / density) / 60f)
    val t = springs.target
    t[0] = 1f + grow + 0.06f * ex - 0.03f * ey
    t[1] = 1f + grow + 0.06f * ey - 0.03f * ex
    t[2] = (dx / density * 0.15f).coerceIn(-12f, 12f)
    t[3] = (dy / density * 0.15f).coerceIn(-12f, 12f)
    t[4] = 1f
    springs.stiffness = PRESS_STIFFNESS
    springs.damping = PRESS_DAMPING
    springs.start()
  }

  fun dragTo(dx: Float, dy: Float) {
    springs.snap(2, dx / density)
    springs.snap(3, dy / density)
    apply()
    onFrame()
  }

  fun release() {
    REST.copyInto(springs.target)
    springs.stiffness = RELEASE_STIFFNESS
    springs.damping = RELEASE_DAMPING
    springs.start()
  }

  fun reset() {
    springs.stop()
    REST.forEachIndexed { i, v -> springs.snap(i, v) }
    apply()
  }

  private fun apply() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val v = springs.value
    if (v[0] == 1f && v[1] == 1f && v[2] == 0f && v[3] == 0f) {
      view.setAnimationMatrix(null)
      return
    }
    matrix.setScale(v[0], v[1], view.width / 2f, view.height / 2f)
    matrix.postTranslate(v[2] * density, v[3] * density)
    view.setAnimationMatrix(matrix)
  }

  private companion object {
    val REST = floatArrayOf(1f, 1f, 0f, 0f, 0f)
    const val PRESS_STIFFNESS = 520f
    const val PRESS_DAMPING = 1f
    // critically damped, no bounce
    const val RELEASE_STIFFNESS = 420f
    const val RELEASE_DAMPING = 1f
  }
}
