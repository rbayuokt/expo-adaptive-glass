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
import android.view.ViewConfiguration
import expo.modules.adaptiveglass.performance.GlassPerformanceMonitor
import expo.modules.adaptiveglass.renderers.AcrylicRenderer
import expo.modules.adaptiveglass.renderers.ShaderGlassRenderer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.max

// iOS 26 style switch. Pressing turns the white thumb into a clear lens over the track, dragging
// moves it and blends the track colour, releasing settles it on the nearest side.
class GlassSwitchView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onValueChange by EventDispatcher<Map<String, Any>>()

  var value = false
  var disabled = false
  var onColor: Int? = null
  var lens = true
  // resolved light / dark from JS, see isNight
  var scheme = "system"

  private val density = resources.displayMetrics.density
  // thumb position 0..1, press 0..1
  private val springs = SpringSet(this, 2) { invalidate() }
  private var placed = false
  private var dragging = false
  private var moved = false
  private var downX = 0f
  private var downPos = 0f
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

  private val trackRect = RectF()
  private val thumbRect = RectF()
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
    val target = if (value) 1f else 0f
    if (!placed) {
      springs.snap(0, target)
      springs.snap(1, 0f)
      placed = true
    } else if (!dragging) {
      settle(target)
    }
    invalidate()
  }

  private fun settle(pos: Float) {
    springs.target[0] = pos
    springs.target[1] = 0f
    springs.stiffness = 420f
    springs.damping = 1f
    springs.start()
  }

  private fun isDark() = isNight(scheme)

  private fun trackColor(pos: Float): Int {
    val on = onColor ?: Color.rgb(52, 199, 89)
    val off = if (isDark()) Color.rgb(57, 57, 61) else Color.rgb(233, 233, 234)
    val t = pos.coerceIn(0f, 1f)
    fun mix(a: Int, b: Int) = (a + (b - a) * t).toInt()
    return Color.rgb(
      mix(Color.red(off), Color.red(on)),
      mix(Color.green(off), Color.green(on)),
      mix(Color.blue(off), Color.blue(on)),
    )
  }

  private fun computeThumb(pos: Float, press: Float) {
    val inset = 2f * density
    val restH = height - 2 * inset
    val restW = restH * 1.55f
    val lensH = height * 1.4f
    val lensW = lensH * 1.5f
    val w = restW + (lensW - restW) * press
    val h = restH + (lensH - restH) * press
    val travel = width - 2 * inset - restW
    val cx = inset + restW / 2 + travel * pos
    thumbRect.set(cx - w / 2, height / 2f - h / 2, cx + w / 2, height / 2f + h / 2)
  }

  private fun drawTrack(canvas: Canvas, pos: Float) {
    trackRect.set(0f, 0f, width.toFloat(), height.toFloat())
    trackPaint.color = trackColor(pos)
    val r = height / 2f
    canvas.drawRoundRect(trackRect, r, r, trackPaint)
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
      shadowPaint.color = AcrylicRenderer.withAlpha(Color.BLACK, 0.12f * solid)
      canvas.drawRoundRect(
        thumbRect.left, thumbRect.top + 1.5f * density, thumbRect.right, thumbRect.bottom + 1.5f * density,
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
    val m = 1f + 0.05f * press
    val cx = thumbRect.centerX()
    val cy = thumbRect.centerY()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && canvas.isHardwareAccelerated) {
      val node = (lensNode as? RenderNode) ?: RenderNode("GlassSwitchLens").also { lensNode = it }
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

  override fun onTouchEvent(ev: MotionEvent): Boolean {
    if (disabled) return false
    val inset = 2f * density
    val restW = (height - 2 * inset) * 1.55f
    val travel = max(1f, width - 2 * inset - restW)
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        parent?.requestDisallowInterceptTouchEvent(true)
        dragging = true
        moved = false
        downX = ev.x
        downPos = springs.value[0]
        springs.target[1] = if (GlassPerformanceMonitor.reduceMotion(context)) 0f else 1f
        springs.stiffness = 700f
        springs.damping = 1f
        springs.start()
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = ev.x - downX
        if (abs(dx) > touchSlop) moved = true
        if (moved) {
          springs.target[0] = (downPos + dx / travel).coerceIn(0f, 1f)
          springs.start()
        }
      }
      MotionEvent.ACTION_UP -> {
        dragging = false
        // a tap flips, a drag lands on whichever side the thumb is closer to
        val next = if (moved) springs.target[0] > 0.5f else !value
        settle(if (next) 1f else 0f)
        if (next != value) {
          value = next
          onValueChange(mapOf("value" to next))
        }
      }
      MotionEvent.ACTION_CANCEL -> {
        dragging = false
        settle(if (value) 1f else 0f)
      }
    }
    return true
  }
}
