package expo.modules.adaptiveglass

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.RenderNode
import android.os.Build
import android.view.ViewTreeObserver
import expo.modules.adaptiveglass.renderers.MergeGlassRenderer
import expo.modules.adaptiveglass.renderers.NativeBlurRenderer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference
import kotlin.math.max
import kotlin.math.min

// On API 33+ members stop drawing their own glass and this view draws one merged shape for all of
// them. Below that there's no RuntimeShader, so members draw themselves and never merge.
class GlassGroupView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var spacingDp = 20f
  var intensity = 0.6f
  var tint: Int? = null
  var tintScheme = "system"

  private val density = resources.displayMetrics.density
  private val members = ArrayList<WeakReference<ExpoAdaptiveGlassView>>()
  private val merges = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

  private var node: Any? = null // RenderNode
  private var blur: Any? = null // NativeBlurRenderer
  private var merge: Any? = null // MergeGlassRenderer
  private var backdrop: GlassBackdropView? = null
  private var backdropVersion = -1

  private val rects = FloatArray(MergeGlassRenderer.MAX * 4)
  // rects in the shaded node's coordinates, reused every frame
  private val nodeRects = FloatArray(MergeGlassRenderer.MAX * 4)
  private val radii = FloatArray(MergeGlassRenderer.MAX)
  private var count = 0
  private val loc = IntArray(2)
  private val memberLoc = IntArray(2)
  private val backdropLoc = IntArray(2)
  private val press = FloatArray(4)
  private var observer: ViewTreeObserver? = null

  private val preDraw = ViewTreeObserver.OnPreDrawListener {
    // only redraw when a member actually moved
    if (collectMembers()) invalidate()
    true
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

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    observer = viewTreeObserver.also { it.addOnPreDrawListener(preDraw) }
  }

  override fun onDetachedFromWindow() {
    observer?.takeIf { it.isAlive }?.removeOnPreDrawListener(preDraw)
    observer = null
    backdrop = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) (node as? RenderNode)?.discardDisplayList()
    super.onDetachedFromWindow()
  }

  fun propsDidUpdate() = invalidate()

  // true when the group draws the member's glass, so the member must not
  fun register(member: ExpoAdaptiveGlassView): Boolean {
    members.removeAll { it.get() == null || it.get() === member }
    members.add(WeakReference(member))
    invalidate()
    return merges && !MergeGlassRenderer.failed
  }

  fun unregister(member: ExpoAdaptiveGlassView) {
    members.removeAll { it.get() == null || it.get() === member }
    invalidate()
  }

  private fun collectMembers(): Boolean {
    if (!merges) return false
    getLocationInWindow(loc)
    var changed = false
    var n = 0
    members.removeAll { it.get() == null }
    for (ref in members) {
      val m = ref.get() ?: continue
      if (n >= MergeGlassRenderer.MAX || !m.isAttachedToWindow || !m.isShown) continue
      // getLocationInWindow follows transforms but width/height don't, so apply the scale by hand
      var sx = 1f
      var sy = 1f
      var v: android.view.View? = m
      while (v != null && v !== this) {
        sx *= v.scaleX
        sy *= v.scaleY
        v = v.parent as? android.view.View
      }
      m.getLocationInWindow(memberLoc)
      val l = (memberLoc[0] - loc[0]).toFloat()
      val t = (memberLoc[1] - loc[1]).toFloat()
      // the press motion lives in the animation matrix, which positions ignore
      m.pressTransform(press)
      val w = m.width * sx * press[0]
      val h = m.height * sy * press[1]
      val cx = l + m.width * sx / 2f + press[2] * sx
      val cy = t + m.height * sy / 2f + press[3] * sy
      val r = min(m.cornerRadiusDp * density * min(sx, sy), min(w, h) / 2f)
      changed = changed or set(rects, n * 4, cx - w / 2f) or set(rects, n * 4 + 1, cy - h / 2f) or
        set(rects, n * 4 + 2, cx + w / 2f) or set(rects, n * 4 + 3, cy + h / 2f) or set(radii, n, r)
      n++
    }
    if (n != count) {
      count = n
      changed = true
    }
    // an animated backdrop changes even when nobody moved
    return changed || (backdrop != null && count > 0)
  }

  private fun set(a: FloatArray, i: Int, v: Float): Boolean {
    if (a[i] == v) return false
    a[i] = v
    return true
  }

  override fun dispatchDraw(canvas: Canvas) {
    if (merges && count > 0 && canvas.isHardwareAccelerated) drawMerged(canvas)
    super.dispatchDraw(canvas)
  }

  private fun drawMerged(canvas: Canvas) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val k = spacingDp * density
    // shade only the members' bounds plus the bridge reach
    var l = Float.MAX_VALUE
    var t = Float.MAX_VALUE
    var r = -Float.MAX_VALUE
    var b = -Float.MAX_VALUE
    for (i in 0 until count) {
      l = min(l, rects[i * 4])
      t = min(t, rects[i * 4 + 1])
      r = max(r, rects[i * 4 + 2])
      b = max(b, rects[i * 4 + 3])
    }
    val left = (l - k).toInt()
    val top = (t - k).toInt()
    val w = (r + k).toInt() - left
    val h = (b + k).toInt() - top
    if (w <= 0 || h <= 0) return

    val bd = backdrop.takeIf { it?.isAttachedToWindow == true && backdropVersion == GlassBackdropView.Registry.version }
      ?: GlassBackdropView.Registry.find(this, loc, backdropLoc).also {
        backdrop = it
        backdropVersion = GlassBackdropView.Registry.version
      }
    val source = bd?.node

    for (i in 0 until count) {
      nodeRects[i * 4] = rects[i * 4] - left
      nodeRects[i * 4 + 1] = rects[i * 4 + 1] - top
      nodeRects[i * 4 + 2] = rects[i * 4 + 2] - left
      nodeRects[i * 4 + 3] = rects[i * 4 + 3] - top
    }

    val dark = when (tintScheme) {
      "dark" -> true
      "light" -> false
      else -> (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    }
    val base = tint ?: if (dark) Color.rgb(28, 28, 32) else Color.rgb(247, 247, 250)
    val tintAlpha = if (source != null) (if (dark) 0.14f else 0.1f) + 0.22f * intensity else 0.62f + 0.28f * intensity

    val blurEffect = if (source != null) NativeBlurRenderer.blur(28f * density) else null
    val m = (merge as? MergeGlassRenderer) ?: MergeGlassRenderer().also { merge = it }
    val effect = m.effect(blurEffect, w.toFloat(), h.toFloat(), nodeRects, radii, count, k, base, tintAlpha, 10f * density, dark)
      ?: return

    val rn = (node as? RenderNode) ?: RenderNode("GlassGroup").also { node = it }
    rn.setPosition(left, top, left + w, top + h)
    rn.setRenderEffect(effect)
    val rc = rn.beginRecording(w, h)
    try {
      if (source != null) {
        getLocationInWindow(loc)
        bd!!.getLocationInWindow(backdropLoc)
        rc.translate(-(loc[0] - backdropLoc[0] + left).toFloat(), -(loc[1] - backdropLoc[1] + top).toFloat())
        rc.drawRenderNode(source)
      } else {
        // no backdrop, the shader tints a flat fill into acrylic
        rc.drawColor(base)
      }
    } finally {
      rn.endRecording()
    }
    canvas.drawRenderNode(rn)
  }
}
