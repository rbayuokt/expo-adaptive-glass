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
    // 0 frosted to 1 clear
    val clarity: Float = 0f,
    val ultra: Boolean = false,
  )

  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val sheenPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  // stacked strokes, brightest at the rim and fading inward. The lit edge of thick glass at ultra
  private val bezelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val bezelRect = RectF()
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
    // neutral frost clears with clarity. A colour tint gets stronger instead, or the frost and a
    // sharper background wash it out
    val c = if (next.tint != null) 0f else next.clarity
    liveFillAlpha = if (next.tint != null) {
      (0.25f + 0.35f * i) * (1f + 0.4f * next.clarity)
    } else {
      ((if (next.dark) 0.14f else 0.1f) + 0.22f * i) * (1f - 0.6f * c)
    }
    // no blur under acrylic, so it only clears so far before text behind gets hard to read past
    acrylicFillAlpha = if (next.opaque) 0.97f else 0.62f + 0.28f * i - 0.3f * c
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

    if (s.ultra && !s.opaque) {
      for (i in BEZEL_WIDTHS.indices) {
        val bw = BEZEL_WIDTHS[i] * density
        bezelPaint.strokeWidth = bw
        bezelPaint.color = withAlpha(light, BEZEL_ALPHAS[i] * (if (s.dark) 0.7f else 1f))
        bezelRect.set(0f, 0f, w.toFloat(), h.toFloat())
        bezelRect.inset(bw / 2, bw / 2)
        canvas.drawRoundRect(bezelRect, maxOf(0f, radius - bw / 2), maxOf(0f, radius - bw / 2), bezelPaint)
      }
    }

    val half = borderPaint.strokeWidth / 2
    rect.inset(half, half)
    canvas.drawRoundRect(rect, radius - half, radius - half, borderPaint)
  }

  private fun rebuildShaders(w: Int, h: Int, s: Style) {
    shaderW = w
    shaderH = h
    // highlights stay at any clarity, they're what still reads as glass when clear
    val sheenAlpha = (if (s.dark) 0.1f else 0.2f) * (0.5f + maxOf(s.intensity, 0.5f))
    sheenPaint.shader = LinearGradient(
      0f, 0f, 0f, h * 0.6f,
      withAlpha(light, sheenAlpha), withAlpha(light, 0f), Shader.TileMode.CLAMP,
    )
    borderPaint.strokeWidth = maxOf(1f, 0.75f * density)
    // lit top-left only, a full rim reads as a white border on clear glass
    borderPaint.shader = if (s.opaque) {
      LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), withAlpha(light, 0.9f), withAlpha(light, 0.5f), Shader.TileMode.CLAMP)
    } else if (s.ultra) {
      // ultra gets a soft rim all the way round like iOS 26 clear glass, brightest top-left
      val top = if (s.dark) 0.45f else 0.35f
      val rest = if (s.dark) 0.14f else 0.15f
      LinearGradient(
        0f, 0f, w.toFloat(), h.toFloat(),
        intArrayOf(withAlpha(light, top), withAlpha(light, rest), withAlpha(light, rest)),
        floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP,
      )
    } else {
      val top = (if (s.dark) 0.45f else 0.38f) * (if (s.minimal) 0.6f else 1f)
      LinearGradient(
        0f, 0f, w.toFloat(), h.toFloat(),
        intArrayOf(withAlpha(light, top), withAlpha(light, 0f), withAlpha(light, 0f)),
        floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP,
      )
    }
    // unit radius at the origin, moved with a local matrix so touches don't allocate
    specPaint.shader = RadialGradient(
      0f, 0f, 1f,
      withAlpha(light, if (s.dark) 0.32f else 0.55f), withAlpha(light, 0f), Shader.TileMode.CLAMP,
    )
  }

  companion object {
    private val BEZEL_WIDTHS = floatArrayOf(1.5f, 3.5f, 7f)
    // lower than iOS: the stacked strokes read stronger on Android at the same alpha
    private val BEZEL_ALPHAS = floatArrayOf(0.055f, 0.035f, 0.02f)
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
