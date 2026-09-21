package expo.modules.adaptiveglass.renderers

import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi

// AGSL lens chained after the blur. Compiled once per surface, the RenderEffect is only rebuilt
// when a uniform changes.
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
class ShaderGlassRenderer {
  private var shader: RuntimeShader? = null
  private var blur: RenderEffect? = null
  private var effect: RenderEffect? = null
  private val last = FloatArray(11) { Float.NaN }

  // null when AGSL isn't usable. blur is null for sharp content like the tab bar lens
  fun effect(
    blur: RenderEffect?,
    w: Float,
    h: Float,
    radius: Float,
    // width of the bending band, the middle stays flat
    bezel: Float,
    refractionPx: Float,
    chroma: Float,
    lightX: Float,
    lightY: Float,
    lightStrength: Float,
    rim: Float,
    press: Float,
  ): RenderEffect? {
    if (failed) return null
    val s = shader ?: try {
      RuntimeShader(SOURCE).also { shader = it }
    } catch (t: Throwable) {
      failed = true
      Log.w("ExpoAdaptiveGlass", "AGSL glass shader unavailable, falling back to blur", t)
      return null
    }
    val uniformsChanged = set(0, w) or set(1, h) or set(2, radius) or set(3, refractionPx) or
      set(4, chroma) or set(5, lightX) or set(6, lightY) or set(7, lightStrength) or
      set(8, rim) or set(9, press) or set(10, bezel)
    if (!uniformsChanged && blur === this.blur && effect != null) return effect
    s.setFloatUniform("size", w, h)
    s.setFloatUniform("radius", radius)
    s.setFloatUniform("bezel", bezel)
    s.setFloatUniform("refraction", refractionPx)
    s.setFloatUniform("chroma", chroma)
    s.setFloatUniform("light", lightX, lightY)
    s.setFloatUniform("lightStrength", lightStrength)
    s.setFloatUniform("rim", rim)
    s.setFloatUniform("press", press)
    this.blur = blur
    val shaderEffect = RenderEffect.createRuntimeShaderEffect(s, "content")
    effect = if (blur != null) RenderEffect.createChainEffect(shaderEffect, blur) else shaderEffect
    return effect
  }

  private fun set(i: Int, v: Float): Boolean {
    if (last[i] == v) return false
    last[i] = v
    return true
  }

  companion object {
    @Volatile var failed = false
      private set

    private const val SOURCE = """
      uniform shader content;
      uniform float2 size;
      uniform float radius;
      uniform float bezel;
      uniform float refraction;
      uniform float chroma;
      uniform float2 light;
      uniform float lightStrength;
      uniform float rim;
      uniform float press;

      float sdf(float2 p) {
        float2 h = size * 0.5;
        float2 q = abs(p - h) - h + radius;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
      }

      half4 main(float2 coord) {
        float d = sdf(coord);
        // 0 across the flat middle, 1 at the rim
        float x = clamp(1.0 + d / max(bezel, 1.0), 0.0, 1.0);
        float2 e = float2(1.0, 0.0);
        float2 n = normalize(float2(sdf(coord + e.xy) - sdf(coord - e.xy),
                                    sdf(coord + e.yx) - sdf(coord - e.yx)) + 0.0001);
        float bend = refraction * (1.0 + 0.35 * press) * x * x * x;
        float2 at = coord - n * bend;
        float2 lo = float2(0.5);
        float2 hi = size - 0.5;
        half4 color = content.eval(clamp(at, lo, hi));
        if (chroma > 0.0 && bend > 0.5) {
          float spread = chroma * bend * 0.08;
          color.r = content.eval(clamp(at - n * spread, lo, hi)).r;
          color.b = content.eval(clamp(at + n * spread, lo, hi)).b;
        }
        float2 l = normalize(light - size * 0.5 + 0.0001);
        float facing = max(dot(n, l), 0.0);
        float backing = max(-dot(n, l), 0.0);
        float edge = pow(x, 6.0);
        float spec = rim * (1.0 + 0.5 * press) * edge *
          (0.9 * pow(facing, 3.0) + 0.25 * pow(backing, 3.0));
        float2 lp = coord - light;
        float spot = lightStrength * exp(-dot(lp, lp) / (0.12 * size.x * size.y + 1.0));
        color.rgb += half3(spec * 0.55 + spot * 0.32) * color.a;
        return color;
      }
    """
  }
}
