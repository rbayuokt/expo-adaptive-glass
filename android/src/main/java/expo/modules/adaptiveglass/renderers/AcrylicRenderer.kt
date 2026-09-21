package expo.modules.adaptiveglass.renderers

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader

// Tint, sheen, border and highlight over the blur (or alone). Gradients only rebuild on size or
// color changes.
class AcrylicRenderer(private val density: Float) {
  data class Style(
    val dark: Boolean,
    val tint: Int?,
    val intensity: Float,
    val opaque: Boolean,
    val minimal: Boolean,
  )

  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val sheenPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val specPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rect = RectF()
  private val specMatrix = Matrix()

  private var style: Style? = null
  private var shaderW = -1
  private var shaderH = -1
  private var liveFillAlpha = 0f
  private var acrylicFillAlpha = 0f
  private var baseColor = Color.WHITE
  private var light = Color.WHITE

  fun configure(next: Style) {
    if (next == style) return
    style = next
    val i = next.intensity
    baseColor = next.tint?.let { it or (0xFF shl 24) }
      ?: if (next.dark) Color.rgb(30, 30, 34) else Color.rgb(247, 247, 250)
    liveFillAlpha = (if (next.dark) 0.14f else 0.1f) + 0.22f * i
    acrylicFillAlpha = if (next.opaque) 0.97f else 0.62f + 0.28f * i
    light = highlight(next.tint, next.dark)
    shaderW = -1 // force gradient rebuild
  }

  // liveMix: 1 with live blur underneath, 0 for pure acrylic
  fun draw(canvas: Canvas, w: Int, h: Int, radius: Float, liveMix: Float, specAlpha: Float, sx: Float, sy: Float) {
    val s = style ?: return
    if (w != shaderW || h != shaderH) rebuildShaders(w, h, s)
    rect.set(0f, 0f, w.toFloat(), h.toFloat())

    val fillAlpha = acrylicFillAlpha + (liveFillAlpha - acrylicFillAlpha) * liveMix
    fillPaint.color = withAlpha(baseColor, fillAlpha)
    canvas.drawRoundRect(rect, radius, radius, fillPaint)

    if (!s.minimal && !s.opaque) canvas.drawRoundRect(rect, radius, radius, sheenPaint)

    if (specAlpha > 0.001f) {
      val r = maxOf(w, h) * 0.6f
      specMatrix.setScale(r, r)
      specMatrix.postTranslate(sx, sy)
      specPaint.shader?.setLocalMatrix(specMatrix)
      specPaint.alpha = (specAlpha * 255).toInt()
      canvas.drawRoundRect(rect, radius, radius, specPaint)
    }

    val half = borderPaint.strokeWidth / 2
    rect.inset(half, half)
    canvas.drawRoundRect(rect, radius - half, radius - half, borderPaint)
  }

  private fun rebuildShaders(w: Int, h: Int, s: Style) {
    shaderW = w
    shaderH = h
    val sheenAlpha = (if (s.dark) 0.12f else 0.32f) * (0.5f + s.intensity)
    sheenPaint.shader = LinearGradient(
      0f, 0f, 0f, h * 0.6f,
      withAlpha(light, sheenAlpha), withAlpha(light, 0f), Shader.TileMode.CLAMP,
    )
    val top = if (s.opaque) 0.9f else if (s.dark) 0.3f else 0.75f
    val bottom = if (s.opaque) 0.5f else if (s.dark) 0.06f else 0.22f
    borderPaint.strokeWidth = maxOf(1f, 0.75f * density)
    // lit from the top-left like the shader
    borderPaint.shader = LinearGradient(
      0f, 0f, w.toFloat(), h.toFloat(),
      withAlpha(light, if (s.minimal) top * 0.6f else top), withAlpha(light, bottom), Shader.TileMode.CLAMP,
    )
    // unit radius at the origin, moved with a local matrix so touches don't allocate
    specPaint.shader = RadialGradient(
      0f, 0f, 1f,
      withAlpha(light, if (s.dark) 0.32f else 0.55f), withAlpha(light, 0f), Shader.TileMode.CLAMP,
    )
  }

  companion object {
    fun withAlpha(color: Int, alpha: Float) =
      (color and 0x00FFFFFF) or ((alpha.coerceIn(0f, 1f) * 255).toInt() shl 24)

    // highlights lean toward the tint, not pure white
    private fun highlight(tint: Int?, dark: Boolean): Int {
      tint ?: return Color.WHITE
      val k = if (dark) 0.6f else 0.75f
      fun mix(c: Int) = (c + (255 - c) * k).toInt()
      return Color.rgb(mix(Color.red(tint)), mix(Color.green(tint)), mix(Color.blue(tint)))
    }
  }
}
