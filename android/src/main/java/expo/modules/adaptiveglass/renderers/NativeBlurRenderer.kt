package expo.modules.adaptiveglass.renderers

import android.graphics.Canvas
import android.graphics.Outline
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.util.LruCache
import androidx.annotation.RequiresApi

// Blurred window into the shared backdrop node. Only this small recording is per surface.
@RequiresApi(Build.VERSION_CODES.S)
class NativeBlurRenderer {
  private val node = RenderNode("ExpoAdaptiveGlass")
  private val outline = Outline()
  private var effect: RenderEffect? = null

  fun draw(
    canvas: Canvas,
    source: RenderNode,
    offsetX: Float,
    offsetY: Float,
    w: Int,
    h: Int,
    radius: Float,
    alpha: Float,
    effect: RenderEffect,
  ) {
    node.setPosition(0, 0, w, h)
    if (effect !== this.effect) {
      node.setRenderEffect(effect)
      this.effect = effect
    }
    outline.setRoundRect(0, 0, w, h, radius)
    node.setOutline(outline)
    node.setClipToOutline(true)
    node.setAlpha(alpha)
    val rc = node.beginRecording(w, h)
    try {
      rc.translate(-offsetX, -offsetY)
      rc.drawRenderNode(source)
    } finally {
      node.endRecording()
    }
    canvas.drawRenderNode(node)
  }

  fun release() {
    node.discardDisplayList()
  }

  companion object {
    // immutable and keyed only by radius, so surfaces share them
    private val cache = LruCache<Int, RenderEffect>(16)

    fun blur(radiusPx: Float): RenderEffect {
      val key = radiusPx.toInt().coerceAtLeast(1)
      return cache.get(key) ?: RenderEffect
        .createBlurEffect(key.toFloat(), key.toFloat(), Shader.TileMode.CLAMP)
        .also { cache.put(key, it) }
    }
  }
}
