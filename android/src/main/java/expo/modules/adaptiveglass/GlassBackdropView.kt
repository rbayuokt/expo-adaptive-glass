package expo.modules.adaptiveglass

import android.content.Context
import android.graphics.Canvas
import android.graphics.RenderNode
import android.os.Build
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference

// Draws itself through its own RenderNode so every surface can reuse that one recording.
// A surface can't live inside the backdrop it samples, the display lists would contain each other.
class GlassBackdropView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val node: RenderNode? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) RenderNode("ExpoAdaptiveGlassBackdrop") else null

  init {
    // or View skips draw() and goes straight to dispatchDraw()
    setWillNotDraw(false)
    clipChildren = false
  }

  // RN already measured and placed the children, LinearLayout must not redo it
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(
      MeasureSpec.getSize(widthMeasureSpec),
      MeasureSpec.getSize(heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  override fun draw(canvas: Canvas) {
    val n = node
    if (n == null || !canvas.isHardwareAccelerated || width == 0 || height == 0) {
      super.draw(canvas)
      return
    }
    n.setPosition(0, 0, width, height)
    val rc = n.beginRecording(width, height)
    try {
      super.draw(rc)
    } finally {
      n.endRecording()
    }
    canvas.drawRenderNode(n)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    Registry.add(this)
  }

  override fun onDetachedFromWindow() {
    Registry.remove(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) node?.discardDisplayList()
    super.onDetachedFromWindow()
  }

  // main thread only
  object Registry {
    private val backdrops = ArrayList<WeakReference<GlassBackdropView>>()
    var version = 0
      private set

    fun add(b: GlassBackdropView) {
      backdrops.removeAll { it.get() == null || it.get() === b }
      backdrops.add(WeakReference(b))
      version++
    }

    fun remove(b: GlassBackdropView) {
      backdrops.removeAll { it.get() == null || it.get() === b }
      version++
    }

    // newest backdrop in the same window that isn't an ancestor of the surface
    fun find(surface: View, surfaceLoc: IntArray, scratch: IntArray): GlassBackdropView? {
      for (i in backdrops.indices.reversed()) {
        val b = backdrops[i].get() ?: continue
        if (!b.isAttachedToWindow || b.rootView !== surface.rootView || isAncestor(b, surface)) continue
        b.getLocationInWindow(scratch)
        val overlaps = surfaceLoc[0] < scratch[0] + b.width && scratch[0] < surfaceLoc[0] + surface.width &&
          surfaceLoc[1] < scratch[1] + b.height && scratch[1] < surfaceLoc[1] + surface.height
        if (overlaps) return b
      }
      return null
    }

    private fun isAncestor(candidate: View, view: View): Boolean {
      var p = view.parent
      while (p != null) {
        if (p === candidate) return true
        p = p.parent
      }
      return false
    }
  }
}
