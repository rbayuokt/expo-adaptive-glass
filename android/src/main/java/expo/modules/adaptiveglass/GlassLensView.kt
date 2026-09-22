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
import android.graphics.Region
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
import kotlin.math.min

// Tab row for GlassTabBar. The magnified copy replays the items' display lists into a capsule
// RenderNode at a larger scale, nothing gets captured or re-rasterised.
class GlassLensView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onTabSelect by EventDispatcher<Map<String, Any>>()

  var selectedIndex = 0
  var lensStyle = "glass"
  var refraction = false
  var tint: Int? = null
  var tintScheme = "system"

  private val density = resources.displayMetrics.density
  // center x (px), item width (px), stretch, press 0..1
  private val springs = SpringSet(this, 4) {
    swellBar()
    invalidate()
  }.also { it.snap(2, 1f) }
  private val barMatrix = Matrix()
  private var placed = false
  private var dragging = false
  private var lastX = 0f
  private var lastTime = 0L
  private var velocity = 0f

  private var lensNode: Any? = null // RenderNode on API 29+
  private var shader: Any? = null // ShaderGlassRenderer on API 33+
  private val rect = RectF()
  private val path = Path()
  private val outline = Outline()
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  // glints at top-left and bottom-right instead of an outline. Built once, moved with a matrix
  private val glintPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    shader = SweepGradient(
      0f, 0f,
      intArrayOf(
        Color.TRANSPARENT,
        AcrylicRenderer.withAlpha(Color.WHITE, 0.7f),
        Color.TRANSPARENT,
        Color.TRANSPARENT,
        AcrylicRenderer.withAlpha(Color.WHITE, 0.95f),
        Color.TRANSPARENT,
        Color.TRANSPARENT,
      ),
      // sweep runs clockwise from +x: 45deg is bottom-right, 225deg top-left
      floatArrayOf(0f, 0.125f, 0.3f, 0.45f, 0.625f, 0.8f, 1f),
    )
  }
  private val glintMatrix = Matrix()

  init {
    setWillNotDraw(false)
    // the lens bulges past the bar, ExpoView would clip it to the padding box
    clipToPadding = false
    clipChildren = false
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  // RN positions the tab items
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    placed = false
  }

  override fun onDetachedFromWindow() {
    springs.stop()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) (lensNode as? RenderNode)?.discardDisplayList()
    super.onDetachedFromWindow()
  }

  fun propsDidUpdate() {
    if (!dragging) settleOn(selectedIndex, animated = placed)
    invalidate()
  }


  private fun itemCenter(i: Int): Float? = getChildAt(i)?.let { it.left + it.width / 2f }

  // Wide enough for the tab's content plus padding, even past its own slot, like iOS 26 does for
  // long labels. The children's union works whether or not RN flattened the tab's wrapper view.
  private fun pillWidth(i: Int): Float {
    val slot = getChildAt(i) as? android.view.ViewGroup ?: return getChildAt(i)?.width?.toFloat() ?: 0f
    var left = Int.MAX_VALUE
    var right = Int.MIN_VALUE
    for (c in 0 until slot.childCount) {
      val v = slot.getChildAt(c)
      left = minOf(left, v.left)
      right = maxOf(right, v.right)
    }
    val content = if (right > left) (right - left).toFloat() else 0f
    return max(slot.width.toFloat(), content + 2 * PILL_PADDING_DP * density)
  }

  private fun settleOn(i: Int, animated: Boolean) {
    val child = getChildAt(i) ?: return
    val cx = child.left + child.width / 2f
    if (!animated || child.width == 0) {
      springs.snap(0, cx)
      springs.snap(1, pillWidth(i))
      springs.snap(2, 1f)
      springs.snap(3, 0f)
      placed = child.width > 0
      invalidate()
      return
    }
    val t = springs.target
    t[0] = cx
    t[1] = pillWidth(i)
    t[2] = 1f
    t[3] = 0f
    springs.stiffness = 420f
    springs.damping = 1f
    springs.start()
  }

  private fun computeRect(press: Float) {
    val v = springs.value
    // at rest the pill fills its tab slot, the bar's 4dp padding is the gap
    val pillH = height.toFloat()
    val pillW = v[1]
    // held, it's 1.18x the whole bar (row + 4dp padding) so it overflows top and bottom like iOS 26
    val barH = height + 8f * density
    val lensH = pillH + (barH * 1.18f - pillH) * press
    val w = (pillW + (max(pillW * 1.25f, lensH * 1.2f) - pillW) * press) * v[2]
    // at rest a wide pill on an end tab is kept inside the bar, the lens may spill over
    val inside = v[0].coerceIn(min(w / 2, width / 2f), max(width - w / 2, width / 2f))
    val cx = inside + (v[0] - inside) * press
    rect.set(cx - w / 2, height / 2f - lensH / 2, cx + w / 2, height / 2f + lensH / 2)
  }

  private fun isDark() = isNight(tintScheme)


  override fun dispatchDraw(canvas: Canvas) {
    if (!placed && childCount > selectedIndex) settleOn(selectedIndex, animated = false)
    if (!placed) {
      super.dispatchDraw(canvas)
      return
    }
    val press = springs.value[3]
    val dark = isDark()
    computeRect(press)
    val r = rect.height() / 2

    if (press < 0.999f) {
      // white vanishes on a light bar, so light mode gets a dark pill
      val base = tint ?: if (dark) Color.WHITE else Color.BLACK
      val a = (if (tint != null) 0.3f else if (dark) 0.16f else 0.07f) * (1f - press)
      fillPaint.shader = null
      fillPaint.color = AcrylicRenderer.withAlpha(base, a)
      canvas.drawRoundRect(rect, r, r, fillPaint)
    }

    val lensUp = press > 0.001f && lensStyle == "glass"
    if (lensUp) {
      // hide the originals under the lens or every label shows twice
      path.reset()
      path.addRoundRect(rect, r, r, Path.Direction.CW)
      val save = canvas.save()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        canvas.clipOutPath(path)
      } else {
        @Suppress("DEPRECATION")
        canvas.clipPath(path, Region.Op.DIFFERENCE)
      }
      super.dispatchDraw(canvas)
      canvas.restoreToCount(save)
    } else {
      super.dispatchDraw(canvas)
    }

    if (lensUp) {
      fillPaint.color = AcrylicRenderer.withAlpha(Color.WHITE, (if (dark) 0.05f else 0.12f) * press)
      canvas.drawRoundRect(rect, r, r, fillPaint)
      drawLens(canvas, press)
      drawGlints(canvas, press)
    }
  }

  // RenderNode + AGSL, ikon sempet ilang pas dilepas gara-gara alpha. udah bener, JANGAN DISENTUH
  private fun drawLens(canvas: Canvas, press: Float) {
    val m = 1f + 0.2f * press
    val cx = rect.centerX()
    val cy = rect.centerY()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && canvas.isHardwareAccelerated) {
      val node = (lensNode as? RenderNode) ?: RenderNode("GlassLens").also { lensNode = it }
      val w = rect.width().toInt()
      val h = rect.height().toInt()
      node.setPosition(rect.left.toInt(), rect.top.toInt(), rect.left.toInt() + w, rect.top.toInt() + h)
      outline.setRoundRect(0, 0, w, h, h / 2f)
      node.setOutline(outline)
      node.setClipToOutline(true)
      // stays opaque: at press 0 the copy matches the originals exactly. Fading it would blank
      // the masked tabs for a few frames on release
      node.setAlpha(1f)
      val rc = node.beginRecording(w, h)
      try {
        rc.translate(-rect.left.toInt().toFloat(), -rect.top.toInt().toFloat())
        rc.scale(m, m, cx, cy)
        val time = drawingTime
        for (i in 0 until childCount) drawChild(rc, getChildAt(i), time)
      } finally {
        node.endRecording()
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val effect = if (refraction) {
          val s = (shader as? ShaderGlassRenderer) ?: ShaderGlassRenderer().also { shader = it }
          s.effect(
            // bend only the outer band, the middle stays a clean magnification
            null, w.toFloat(), h.toFloat(), h / 2f, h * 0.28f, 10f * density * press, 1f,
            -0.25f * w, -0.6f * h, 0f, 1f, press,
          )
        } else {
          null
        }
        node.setRenderEffect(effect)
      }
      canvas.drawRenderNode(node)
    } else {
      // pre-Q: clipped canvas instead of a RenderNode
      path.reset()
      path.addRoundRect(rect, rect.height() / 2, rect.height() / 2, Path.Direction.CW)
      val save = canvas.save()
      canvas.clipPath(path)
      canvas.scale(m, m, cx, cy)
      super.dispatchDraw(canvas)
      canvas.restoreToCount(save)
    }
  }

  private fun drawGlints(canvas: Canvas, alpha: Float) {
    glintMatrix.setTranslate(rect.centerX(), rect.centerY())
    glintPaint.shader.setLocalMatrix(glintMatrix)
    glintPaint.strokeWidth = 1.5f * density
    glintPaint.alpha = (alpha.coerceIn(0f, 1f) * 255).toInt()
    val half = glintPaint.strokeWidth / 2
    val r = rect.height() / 2 - half
    canvas.drawRoundRect(rect.left + half, rect.top + half, rect.right - half, rect.bottom - half, r, r, glintPaint)
  }



  // bar swells a little while held. setAnimationMatrix leaves RN's transform alone
  private fun swellBar() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val bar = parent as? android.view.View ?: return
    val press = springs.value[3]
    if (press < 0.001f) {
      bar.setAnimationMatrix(null)
      return
    }
    val k = 1f + 0.03f * press
    barMatrix.setScale(k, k, bar.width / 2f, bar.height / 2f)
    bar.setAnimationMatrix(barMatrix)
  }


  // RN text and icons inside the tabs would claim the touch stream otherwise. The root view
  // still sees every event, so JS responders keep working
  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean = childCount > 0

  override fun onTouchEvent(ev: MotionEvent): Boolean {
    if (childCount == 0) return false
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        dragging = true
        parent?.requestDisallowInterceptTouchEvent(true)
        lastX = ev.x
        lastTime = ev.eventTime
        velocity = 0f
        val t = springs.target
        t[0] = clampX(ev.x)
        t[2] = 1f
        t[3] = if (GlassPerformanceMonitor.reduceMotion(context)) 0f else 1f
        springs.stiffness = 700f
        springs.damping = 1f
        springs.start()
      }
      MotionEvent.ACTION_MOVE -> {
        val dt = max(1L, ev.eventTime - lastTime)
        velocity = 0.7f * velocity + 0.3f * ((ev.x - lastX) / dt * 1000f)
        lastX = ev.x
        lastTime = ev.eventTime
        springs.target[0] = clampX(ev.x)
        springs.target[2] = 1f + min(0.3f, abs(velocity) / density / 2500f)
        springs.start()
      }
      MotionEvent.ACTION_UP -> {
        dragging = false
        val i = nearest(ev.x)
        settleOn(i, animated = true)
        if (i != selectedIndex) {
          selectedIndex = i
          onTabSelect(mapOf("index" to i))
        }
      }
      MotionEvent.ACTION_CANCEL -> {
        dragging = false
        settleOn(selectedIndex, animated = true)
      }
    }
    return true
  }

  private fun clampX(x: Float): Float {
    val first = itemCenter(0) ?: return x
    val last = itemCenter(childCount - 1) ?: return x
    return x.coerceIn(first, last)
  }

  private fun nearest(x: Float): Int {
    var best = 0
    var bestDistance = Float.MAX_VALUE
    for (i in 0 until childCount) {
      val d = abs((itemCenter(i) ?: continue) - x)
      if (d < bestDistance) {
        bestDistance = d
        best = i
      }
    }
    return best
  }

  private companion object {
    const val PILL_PADDING_DP = 14f
  }
}
