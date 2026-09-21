package expo.modules.adaptiveglass.renderers

import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi

// Smooth union of up to 8 rounded rects in one AGSL pass. The edge normal is only computed near
// the edge, so the interior costs one distance evaluation per pixel.
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
class MergeGlassRenderer {
  private var shader: RuntimeShader? = null
  private var blur: RenderEffect? = null
  private var effect: RenderEffect? = null
  private val lastRects = FloatArray(MAX * 4)
  private val lastRadii = FloatArray(MAX)
  private val lastScalars = FloatArray(8) { Float.NaN }

  fun effect(
    blur: RenderEffect?,
    w: Float,
    h: Float,
    rects: FloatArray,
    radii: FloatArray,
    count: Int,
    k: Float,
    tint: Int,
    tintAlpha: Float,
    refractionPx: Float,
    dark: Boolean,
  ): RenderEffect? {
    if (failed) return null
    val s = shader ?: try {
      RuntimeShader(SOURCE).also { shader = it }
    } catch (t: Throwable) {
      failed = true
      Log.w("ExpoAdaptiveGlass", "merge shader unavailable, surfaces stay separate", t)
      return null
    }
    var changed = blur !== this.blur || effect == null || !rects.contentEquals(lastRects) || !radii.contentEquals(lastRadii)
    changed = changed or set(0, w) or set(1, h) or set(2, count.toFloat()) or set(3, k) or
      set(4, tint.toFloat()) or set(5, tintAlpha) or set(6, refractionPx) or set(7, if (dark) 1f else 0f)
    if (!changed) return effect
    rects.copyInto(lastRects)
    radii.copyInto(lastRadii)
    s.setFloatUniform("size", w, h)
    s.setFloatUniform("rects", rects)
    s.setFloatUniform("radii", radii)
    s.setFloatUniform("count", count.toFloat())
    s.setFloatUniform("k", k)
    val a = tintAlpha.coerceIn(0f, 1f)
    // premultiplied tint
    s.setFloatUniform(
      "tint",
      android.graphics.Color.red(tint) / 255f * a,
      android.graphics.Color.green(tint) / 255f * a,
      android.graphics.Color.blue(tint) / 255f * a,
      a,
    )
    s.setFloatUniform("refraction", refractionPx)
    s.setFloatUniform("dark", if (dark) 1f else 0f)
    this.blur = blur
    val merge = RenderEffect.createRuntimeShaderEffect(s, "content")
    effect = if (blur != null) RenderEffect.createChainEffect(merge, blur) else merge
    return effect
  }

  private fun set(i: Int, v: Float): Boolean {
    if (lastScalars[i] == v) return false
    lastScalars[i] = v
    return true
  }

  companion object {
    const val MAX = 8

    @Volatile var failed = false
      private set

    private const val SOURCE = """
      uniform shader content;
      uniform float2 size;
      uniform float4 rects[8];
      uniform float radii[8];
      uniform float count;
      uniform float k;
      uniform half4 tint;
      uniform float refraction;
      uniform float dark;

      float roundRect(float2 p, float4 r, float rad) {
        float2 c = (r.xy + r.zw) * 0.5;
        float2 h = (r.zw - r.xy) * 0.5;
        float2 q = abs(p - c) - h + rad;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
      }

      // smooth min: shapes closer than k grow a bridge
      float field(float2 p) {
        float d = roundRect(p, rects[0], radii[0]);
        for (int i = 1; i < 8; i++) {
          if (float(i) < count) {
            float di = roundRect(p, rects[i], radii[i]);
            float t = clamp(0.5 + 0.5 * (di - d) / k, 0.0, 1.0);
            d = mix(di, d, t) - k * t * (1.0 - t);
          }
        }
        return d;
      }

      half4 main(float2 p) {
        float d = field(p);
        float coverage = clamp(0.5 - d, 0.0, 1.0);
        if (coverage <= 0.0) return half4(0.0);
        float bezel = 14.0;
        float x = clamp(1.0 + d / bezel, 0.0, 1.0);
        float2 n = float2(0.0);
        if (x > 0.0) {
          float2 e = float2(1.0, 0.0);
          n = normalize(float2(field(p + e.xy) - field(p - e.xy), field(p + e.yx) - field(p - e.yx)) + 0.0001);
        }
        half4 c = content.eval(clamp(p - n * refraction * x * x * x, float2(0.5), size - 0.5));
        c.rgb = c.rgb * (1.0 - tint.a) + tint.rgb;
        c.a = 1.0;
        // rim toward the top-left, fainter on the far side, plus a hairline
        float2 l = normalize(float2(-1.0, -1.2));
        float facing = max(dot(n, l), 0.0);
        float backing = max(-dot(n, l), 0.0);
        float edge = pow(x, 6.0);
        float rim = edge * (0.9 * pow(facing, 3.0) + 0.3 * pow(backing, 3.0)) * (dark > 0.5 ? 0.45 : 0.7);
        float hairline = (1.0 - clamp(abs(d + 0.75), 0.0, 1.0)) * (dark > 0.5 ? 0.18 : 0.35);
        c.rgb += half3(rim + hairline);
        return c * coverage;
      }
    """
  }
}
