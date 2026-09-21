package expo.modules.adaptiveglass

import android.view.View
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sin
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
      var moving = false
      for (i in value.indices) {
        step(i, dt)
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

  // kembaran SpringDriver di iOS. kalo ubah satu, ubah dua-duanya, jangan lupa kayak gw kemaren
  // exact solution of the damped spring over dt. Euler steps lurch on the first frames at 60 Hz
  private fun step(i: Int, dt: Float) {
    val w = sqrt(stiffness)
    val z = damping
    val x0 = value[i] - target[i]
    val v0 = velocity[i]
    val x: Float
    val v: Float
    if (z < 1f) {
      val wd = w * sqrt(1f - z * z)
      val e = exp(-z * w * dt)
      val c = cos(wd * dt)
      val s = sin(wd * dt)
      val b = (v0 + z * w * x0) / wd
      x = e * (x0 * c + b * s)
      v = e * ((b * wd - z * w * x0) * c - (x0 * wd + z * w * b) * s)
    } else {
      val e = exp(-w * dt)
      val b = v0 + w * x0
      x = (x0 + b * dt) * e
      v = (b - w * (x0 + b * dt)) * e
    }
    value[i] = target[i] + x
    velocity[i] = v
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
