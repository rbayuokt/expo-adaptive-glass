package expo.modules.adaptiveglass

import android.content.Context
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
import android.view.ViewConfiguration
import expo.modules.adaptiveglass.renderers.AcrylicRenderer
import expo.modules.adaptiveglass.renderers.ShaderGlassRenderer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.hypot
import kotlin.math.min

// Holding the content lifts a clear lens that follows the finger and magnifies what's under it.
// Like the tab bar lens it replays the children's display lists, nothing is captured.
class GlassMagnifierView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val density = resources.displayMetrics.density

  var lensWidth = 96f
  var lensHeight = 64f
  var magnification = 1.4f
  var lift = 0f
  var refraction = true
  var disabled = false

  // finger x, finger y (px), press 0..1
  private val springs = SpringSet(this, 3) { invalidate() }
  private var active = false
  private var downX = 0f
  private var downY = 0f
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  // a short hold, so a scroll view around it still gets its swipes
  private val activate = Runnable { begin() }

  private val rect = RectF()
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

  // RN already measured and placed the children, LinearLayout must not redo it
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  override fun onDetachedFromWindow() {
    removeCallbacks(activate)
    springs.stop()
    springs.snap(2, 0f)
    active = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) (lensNode as? RenderNode)?.discardDisplayList()
    super.onDetachedFromWindow()
  }

  private fun computeRect(press: Float) {
    val v = springs.value
    // grows out of the finger, `lift` floats it above
    val k = 0.4f + 0.6f * press
    val w = lensWidth * density * k
    val h = lensHeight * density * k
    val cy = v[1] - lift * density * press
    rect.set(v[0] - w / 2, cy - h / 2, v[0] + w / 2, cy + h / 2)
  }

  override fun dispatchDraw(canvas: Canvas) {
    val press = springs.value[2]
    if (press <= 0.001f) {
      super.dispatchDraw(canvas)
      return
    }
    computeRect(press)
    val r = min(rect.width(), rect.height()) / 2
    // the originals under the lens are hidden or they'd show twice
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
    drawLens(canvas, press, r)
    drawGlints(canvas, press, r)
  }

  // maps the finger point to the lens center. At press 0 that's the identity, so the copy
  // lands on the originals and never has to fade
  private fun transformToLens(c: Canvas, press: Float) {
    val m = 1f + (magnification - 1f) * press
    c.translate(rect.centerX(), rect.centerY())
    c.scale(m, m)
    c.translate(-springs.value[0], -springs.value[1])
  }

  private fun drawLens(canvas: Canvas, press: Float, radius: Float) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && canvas.isHardwareAccelerated) {
      val node = (lensNode as? RenderNode) ?: RenderNode("GlassMagnifier").also { lensNode = it }
      val left = rect.left.toInt()
      val top = rect.top.toInt()
      val w = rect.width().toInt()
      val h = rect.height().toInt()
      node.setPosition(left, top, left + w, top + h)
      outline.setRoundRect(0, 0, w, h, radius)
      node.setOutline(outline)
      node.setClipToOutline(true)
      val rc = node.beginRecording(w, h)
      try {
        rc.translate(-left.toFloat(), -top.toFloat())
        transformToLens(rc, press)
        val time = drawingTime
        for (i in 0 until childCount) drawChild(rc, getChildAt(i), time)
      } finally {
        node.endRecording()
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val effect = if (refraction) {
          val s = (shader as? ShaderGlassRenderer) ?: ShaderGlassRenderer().also { shader = it }
          s.effect(
            null, w.toFloat(), h.toFloat(), radius, min(w, h) * 0.25f, 5f * density * press, 1f,
            -0.25f * w, -0.6f * h, 0f, 1f, press,
          )
        } else {
          null
        }
        node.setRenderEffect(effect)
      }
      canvas.drawRenderNode(node)
    } else {
      val save = canvas.save()
      path.reset()
      path.addRoundRect(rect, radius, radius, Path.Direction.CW)
      canvas.clipPath(path)
      transformToLens(canvas, press)
      super.dispatchDraw(canvas)
      canvas.restoreToCount(save)
    }
  }

  private fun drawGlints(canvas: Canvas, press: Float, radius: Float) {
    glintMatrix.setTranslate(rect.centerX(), rect.centerY())
    glintPaint.shader.setLocalMatrix(glintMatrix)
    glintPaint.strokeWidth = 1.5f * density
    glintPaint.alpha = (255 * press).toInt()
    val half = glintPaint.strokeWidth / 2
    canvas.drawRoundRect(
      rect.left + half, rect.top + half, rect.right - half, rect.bottom - half,
      radius - half, radius - half, glintPaint,
    )
  }

  private fun begin() {
    active = true
    parent?.requestDisallowInterceptTouchEvent(true)
    if (springs.value[2] <= 0.001f) {
      springs.snap(0, downX)
      springs.snap(1, downY)
    }
    springs.target[0] = downX
    springs.target[1] = downY
    springs.target[2] = 1f
    springs.stiffness = 700f
    springs.damping = 1f
    springs.start()
  }

  private fun end() {
    removeCallbacks(activate)
    if (!active) return
    active = false
    springs.target[2] = 0f
    springs.stiffness = 420f
    springs.damping = 1f
    springs.start()
  }

  // Seen from both the intercept and the touch handler, so every step is safe to repeat
  private fun track(ev: MotionEvent) {
    if (disabled) return
    val x = ev.x.coerceIn(0f, width.toFloat())
    val y = ev.y.coerceIn(0f, height.toFloat())
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = x
        downY = y
        removeCallbacks(activate)
        postDelayed(activate, 150)
      }
      MotionEvent.ACTION_MOVE -> {
        if (active) {
          springs.target[0] = x
          springs.target[1] = y
          springs.start()
        } else if (hypot(x - downX, y - downY) > touchSlop) {
          removeCallbacks(activate)
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> end()
    }
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    track(ev)
    return active
  }

  override fun onTouchEvent(ev: MotionEvent): Boolean {
    track(ev)
    return !disabled
  }
}
