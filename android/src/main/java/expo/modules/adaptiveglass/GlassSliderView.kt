package expo.modules.adaptiveglass

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.RenderNode
import android.graphics.SweepGradient
import android.os.Build
import android.view.MotionEvent
import expo.modules.adaptiveglass.performance.GlassPerformanceMonitor
import expo.modules.adaptiveglass.renderers.AcrylicRenderer
import expo.modules.adaptiveglass.renderers.ShaderGlassRenderer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.max

// iOS 26 style slider. The white thumb turns into a clear lens over the track while it's held and
// dragged, then settles back into the thumb.
class GlassSliderView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onValueChange by EventDispatcher<Map<String, Any>>()
  val onSlidingComplete by EventDispatcher<Map<String, Any>>()

  // 0..1, JS maps it to the real range
  var value = 0f
  var disabled = false
  var fillColor: Int? = null
  var lens = true
  // resolved light / dark from JS, see isNight
  var scheme = "system"

  private val density = resources.displayMetrics.density
  // thumb position 0..1, press 0..1
  private val springs = SpringSet(this, 2) { invalidate() }
  private var placed = false
  private var dragging = false
  private var downX = 0f
  private var downPos = 0f
  private var lastSent = -1f

  private val restW get() = 38f * density
  private val restH get() = 24f * density
  private val trackH get() = 6f * density
  private val travel get() = max(1f, width - restW)

  private val thumbRect = RectF()
  private val barRect = RectF()
  private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val thumbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
  private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val path = Path()
  private val outline = Outline()
  private var lensNode: Any? = null // RenderNode on API 29+
  private var shader: Any? = null // ShaderGlassRenderer on API 33+
  private val glintMatrix = Matrix()
  private val glintPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    shader = SweepGradient(
      0f, 0f,
      intArrayOf(
        Color.TRANSPARENT, AcrylicRenderer.withAlpha(Color.WHITE, 0.7f), Color.TRANSPARENT,
        Color.TRANSPARENT, AcrylicRenderer.withAlpha(Color.WHITE, 0.95f), Color.TRANSPARENT,
        Color.TRANSPARENT,
      ),
      floatArrayOf(0f, 0.125f, 0.3f, 0.45f, 0.625f, 0.8f, 1f),
    )
  }

  init {
    setWillNotDraw(false)
    clipChildren = false
    clipToPadding = false
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  override fun onDetachedFromWindow() {
    springs.stop()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) (lensNode as? RenderNode)?.discardDisplayList()
    super.onDetachedFromWindow()
  }

  fun propsDidUpdate() {
    alpha = if (disabled) 0.45f else 1f
    val target = value.coerceIn(0f, 1f)
    if (!placed) {
      springs.snap(0, target)
      springs.snap(1, 0f)
      placed = true
    } else if (!dragging) {
      springs.target[0] = target
      springs.stiffness = 420f
      springs.damping = 1f
      springs.start()
    }
    invalidate()
  }

  private fun isDark() = isNight(scheme)

  private fun computeThumb(pos: Float, press: Float) {
    val lensH = restH * 1.5f
    val lensW = lensH * 1.6f
    val w = restW + (lensW - restW) * press
    val h = restH + (lensH - restH) * press
    val cx = restW / 2 + travel * pos
    thumbRect.set(cx - w / 2, height / 2f - h / 2, cx + w / 2, height / 2f + h / 2)
  }

  private fun drawTrack(canvas: Canvas, pos: Float) {
    val r = trackH / 2
    barRect.set(0f, height / 2f - r, width.toFloat(), height / 2f + r)
    trackPaint.color = if (isDark()) AcrylicRenderer.withAlpha(Color.WHITE, 0.2f) else AcrylicRenderer.withAlpha(Color.BLACK, 0.1f)
    canvas.drawRoundRect(barRect, r, r, trackPaint)
    barRect.right = max(trackH, restW / 2 + travel * pos)
    trackPaint.color = fillColor ?: Color.rgb(10, 132, 255)
    canvas.drawRoundRect(barRect, r, r, trackPaint)
  }

  override fun onDraw(canvas: Canvas) {
    if (width == 0 || height == 0) return
    val pos = springs.value[0]
    val press = if (lens) springs.value[1] else 0f
    computeThumb(pos, press)
    val r = thumbRect.height() / 2

    // masked under the lens so the track doesn't show twice
    if (press > 0.001f) {
      path.reset()
      path.addRoundRect(thumbRect, r, r, Path.Direction.CW)
      val save = canvas.save()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        canvas.clipOutPath(path)
      } else {
        @Suppress("DEPRECATION")
        canvas.clipPath(path, android.graphics.Region.Op.DIFFERENCE)
      }
      drawTrack(canvas, pos)
      canvas.restoreToCount(save)
    } else {
      drawTrack(canvas, pos)
    }

    val solid = 1f - press
    if (solid > 0.001f) {
      shadowPaint.color = AcrylicRenderer.withAlpha(Color.BLACK, 0.14f * solid)
      canvas.drawRoundRect(
        thumbRect.left, thumbRect.top + 2f * density, thumbRect.right, thumbRect.bottom + 2f * density,
        r, r, shadowPaint,
      )
    }
    if (press > 0.001f) drawLens(canvas, pos, press, r)
    // drawn over the lens, so on release its fade-in hides the shrinking lens
    if (solid > 0.001f) {
      thumbPaint.alpha = (255 * solid).toInt()
      canvas.drawRoundRect(thumbRect, r, r, thumbPaint)
    }
    if (press > 0.001f) {
      glintMatrix.setTranslate(thumbRect.centerX(), thumbRect.centerY())
      glintPaint.shader.setLocalMatrix(glintMatrix)
      glintPaint.strokeWidth = 1.5f * density
      glintPaint.alpha = (255 * press).toInt()
      val half = glintPaint.strokeWidth / 2
      canvas.drawRoundRect(
        thumbRect.left + half, thumbRect.top + half, thumbRect.right - half, thumbRect.bottom - half,
        r - half, r - half, glintPaint,
      )
    }
  }

  private fun drawLens(canvas: Canvas, pos: Float, press: Float, radius: Float) {
    val m = 1f + 0.25f * press
    val cx = thumbRect.centerX()
    val cy = thumbRect.centerY()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && canvas.isHardwareAccelerated) {
      val node = (lensNode as? RenderNode) ?: RenderNode("GlassSliderLens").also { lensNode = it }
      val left = thumbRect.left.toInt()
      val top = thumbRect.top.toInt()
      val w = thumbRect.width().toInt()
      val h = thumbRect.height().toInt()
      node.setPosition(left, top, left + w, top + h)
      outline.setRoundRect(0, 0, w, h, radius)
      node.setOutline(outline)
      node.setClipToOutline(true)
      val rc = node.beginRecording(w, h)
      try {
        rc.translate(-left.toFloat(), -top.toFloat())
        rc.scale(m, m, cx, cy)
        drawTrack(rc, pos)
      } finally {
        node.endRecording()
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val s = (shader as? ShaderGlassRenderer) ?: ShaderGlassRenderer().also { shader = it }
        node.setRenderEffect(
          s.effect(
            null, w.toFloat(), h.toFloat(), radius, h * 0.25f, 3f * density * press, 1f,
            -0.25f * w, -0.6f * h, 0f, 1f, press,
          ),
        )
      }
      canvas.drawRenderNode(node)
    } else {
      val save = canvas.save()
      path.reset()
      path.addRoundRect(thumbRect, radius, radius, Path.Direction.CW)
      canvas.clipPath(path)
      canvas.scale(m, m, cx, cy)
      drawTrack(canvas, pos)
      canvas.restoreToCount(save)
    }
  }

  private fun send(pos: Float) {
    if (abs(pos - lastSent) <= 0.0005f) return
    lastSent = pos
    onValueChange(mapOf("value" to pos))
  }

  override fun onTouchEvent(ev: MotionEvent): Boolean {
    if (disabled) return false
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        parent?.requestDisallowInterceptTouchEvent(true)
        dragging = true
        downX = ev.x
        // a touch off the thumb jumps it there first
        val current = springs.value[0]
        val thumbX = restW / 2 + travel * current
        downPos = if (abs(ev.x - thumbX) <= restW) current else ((ev.x - restW / 2) / travel).coerceIn(0f, 1f)
        springs.target[0] = downPos
        springs.target[1] = if (GlassPerformanceMonitor.reduceMotion(context)) 0f else 1f
        springs.stiffness = 700f
        springs.damping = 1f
        springs.start()
        send(downPos)
      }
      MotionEvent.ACTION_MOVE -> {
        val pos = (downPos + (ev.x - downX) / travel).coerceIn(0f, 1f)
        springs.target[0] = pos
        springs.start()
        send(pos)
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        dragging = false
        springs.target[1] = 0f
        springs.stiffness = 420f
        springs.damping = 1f
        springs.start()
        onSlidingComplete(mapOf("value" to springs.target[0]))
      }
    }
    return true
  }
}
