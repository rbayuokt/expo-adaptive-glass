package expo.modules.adaptiveglass

import android.view.View
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sqrt

// Damped springs on the view's animation clock. Only ticks while something is moving.
class SpringSet(private val view: View, size: Int, private val onFrame: () -> Unit) {
  val value = FloatArray(size)
  val target = FloatArray(size)
  private val velocity = FloatArray(size)
  var stiffness = 500f
  var damping = 0.75f
  private var lastFrameNs = 0L
  private var running = false

  private val step = object : Runnable {
    override fun run() {
      val now = System.nanoTime()
      // clamp dt so a stalled frame doesn't blow up the spring
      val dt = if (lastFrameNs == 0L) 1f / 60f else min((now - lastFrameNs) / 1e9f, 1f / 30f)
      lastFrameNs = now
      val c = 2f * damping * sqrt(stiffness)
      var moving = false
      for (i in value.indices) {
        val a = -stiffness * (value[i] - target[i]) - c * velocity[i]
        velocity[i] += a * dt
        value[i] += velocity[i] * dt
        if (abs(value[i] - target[i]) > 0.0005f * maxOf(1f, abs(target[i])) || abs(velocity[i]) > 0.001f) {
          moving = true
        }
      }
      if (!moving) {
        for (i in value.indices) {
          value[i] = target[i]
          velocity[i] = 0f
        }
      }
      onFrame()
      if (moving) view.postOnAnimation(this) else running = false
    }
  }

  fun snap(i: Int, v: Float) {
    value[i] = v
    target[i] = v
    velocity[i] = 0f
  }

  fun start() {
    if (running) return
    running = true
    lastFrameNs = 0L
    view.postOnAnimation(step)
  }

  fun stop() {
    view.removeCallbacks(step)
    running = false
  }
}
