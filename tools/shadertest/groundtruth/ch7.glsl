// SPIR-V reflection failed for backend HLSL:
// cbuffer ID 5618 (name: _Globals_), member index 3 (name: g_vColor2) cannot be expressed with either HLSL packing layout or packoffset.
//
// Re-attempting reflection with the GLSL backend.

// Source 2 Viewer 19.2.0.0 - https://valveresourceformat.github.io
// SPIR-V source (9596 bytes), GLSL reflection with SPIRV-Cross by KhronosGroup
// Static combos: S_PAINT_STYLE=7, S_SEPARATE_CHANNEL_INPUTS, S_CASE_HARDENING

#version 460

vec4 _2;

struct _2179
{
    int bRoughnessMode;
    vec3 g_vColor0;
    vec3 g_vColor1;
    vec3 g_vColor2;
    vec3 g_vColor3;
    float g_flColorBrightness;
    int g_nColorAdjustmentMode;
    float g_flPaintRoughness;
    float g_flPearlescentScale;
    float g_flWearAmount;
    float g_flCaseHardeningPatternInfluence;
    float g_flCaseHardeningGeometricInfluence;
    float g_flCaseHardeningRampOffset;
    vec3 g_vPaintAlbedoLevels;
    vec3 g_vMetallicPaintAlbedoLevels;
};

layout(set = 1) uniform _2179 _Globals_;

layout(set = 1, binding = 30) uniform texture2D g_tAmbientOcclusion;
layout(set = 1, binding = 23) uniform sampler g_sTrilinearClamp;
layout(set = 1, binding = 31) uniform texture2D g_tMasks;
layout(set = 1, binding = 39) uniform texture2D g_tWear;
layout(set = 1, binding = 22) uniform sampler g_sTrilinearWrap;
layout(set = 1, binding = 38) uniform texture2D g_tPattern;
layout(set = 1, binding = 27) uniform sampler AddressU_dynamic_AddressV_dynamic;
layout(set = 1, binding = 36) uniform texture2D g_tNormal;
layout(set = 1, binding = 41) uniform texture2D g_tCaseHardeningColorRamp;
layout(set = 1, binding = 40) uniform texture2D g_tGrunge;
layout(set = 1, binding = 35) uniform texture2D g_tMetalness;
layout(set = 1, binding = 34) uniform texture2D g_tColor;
layout(set = 1, binding = 37) uniform texture2D g_tGlitterNormal;

layout(location = 1) in vec4 input_0;
layout(location = 2) in vec4 input_1;
layout(location = 0) out vec4 output_0;

void main()
{
    vec4 _18087 = texture(sampler2D(g_tAmbientOcclusion, g_sTrilinearClamp), input_0.xy);
    float _11142 = pow(_18087.x, 1.5);
    float _4306 = _11142 * 0.959999978542327880859375;
    float _5542 = _18087.y;
    vec4 _18992 = texture(sampler2D(g_tMasks, g_sTrilinearClamp), input_0.xy);
    float _18510 = _18087.w;
    vec4 _19334 = texture(sampler2D(g_tWear, g_sTrilinearWrap), input_1.xy);
    float _5744 = _19334.x;
    vec4 _22452 = texture(sampler2D(g_tPattern, AddressU_dynamic_AddressV_dynamic), input_0.zw);
    vec4 _9448 = texture(sampler2D(g_tNormal, g_sTrilinearWrap), input_0.xy);
    vec4 _19604 = smoothstep(vec4(0.85000002384185791015625), vec4(0.20000000298023223876953125), min(_9448, vec4(1.0) - _9448));
    float _4409 = mix(0.5, pow(_4306, 0.85000002384185791015625), _Globals_.g_flCaseHardeningGeometricInfluence) * mix(1.0, _5542 * (min(_19604.x, _19604.y) * 2.0), _Globals_.g_flCaseHardeningGeometricInfluence);
    vec4 _19335 = texture(sampler2D(g_tCaseHardeningColorRamp, g_sTrilinearClamp), vec2(mix(_4409 * 2.0, _4409 + _22452.x, _Globals_.g_flCaseHardeningPatternInfluence), max(_22452.y * _Globals_.g_flCaseHardeningPatternInfluence, ((1.0 - _5542) * 0.20000000298023223876953125) * _Globals_.g_flCaseHardeningGeometricInfluence) + _Globals_.g_flCaseHardeningRampOffset));
    float _15054 = _19335.w;
    vec4 _19372 = texture(sampler2D(g_tGrunge, g_sTrilinearWrap), input_1.zw);
    float _8353 = smoothstep(0.20000000298023223876953125, 0.60000002384185791015625, ((_5744 * _5542) * (_5744 * smoothstep(0.20000000298023223876953125, 0.300000011920928955078125, _4306))) * _Globals_.g_flWearAmount);
    float _6896 = smoothstep(0.5 * _Globals_.g_flWearAmount, 0.0, clamp(((_11142 * 11.51999950408935546875) * _5542) - ((_Globals_.g_flWearAmount * clamp((_19372.x * _19372.y) * _19372.z, 0.0, 1.0)) * 2.0), 0.0, 1.0)) * _Globals_.g_flWearAmount;
    float _5609 = 1.0 - _6896;
    vec4 _8001 = max(mix(vec4(1.0), _19372, vec4((pow(1.0 - _4306, 4.0) * 0.25) + (0.75 * _Globals_.g_flWearAmount))), vec4(saturate(_8353 * 2.0)));
    float _10247;
    vec4 _11711;
    if (_Globals_.bRoughnessMode != 0)
    {
        vec4 _19336 = texture(sampler2D(g_tMetalness, g_sTrilinearClamp), input_0.xy);
        float _8824 = _18992.x;
        float _9781 = dot(_8001.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
        float _23988 = _8001.w;
        float _19555 = (1.0 - _23988) * _Globals_.g_flWearAmount;
        float _20709 = clamp(((((_Globals_.g_flPaintRoughness * (1.0 - (0.25 * dot(_19335.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))))) * mix(1.0, 0.89999997615814208984375, _8353)) + (((1.0 - _9781) * _Globals_.g_flWearAmount) * 0.0500000007450580596923828125)) + ((_6896 * 0.1500000059604644775390625) * _Globals_.g_flWearAmount)) + (_19555 * 0.1500000059604644775390625), 0.0, 1.0);
        float _14204 = mix(_15054 * mix(1.0, pow((_5609 * _23988) * _9781, 0.5), _Globals_.g_flWearAmount), 1.0, _8353);
        float _24384 = mix(_19336.x, mix(min(1.0, _20709 + ((_19555 * _Globals_.g_flWearAmount) * 0.5)), _20709, _8824), step(_18510, 0.995999991893768310546875) * _8824);
        float _8449 = mix(_19336.y, _14204, _8824);
        float _11381 = 1.0 - _18510;
        vec4 _6640 = vec4(_24384, _8449, _11381, min(1.0, _Globals_.g_flPearlescentScale));
        vec3 _21659 = _6640.xyz;
        vec3 _10597 = _21659 * vec3(0.077399380505084991455078125);
        vec3 _9357 = pow((_21659 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
        float _23035;
        if (_24384 <= 0.040449999272823333740234375)
        {
            _23035 = _10597.x;
        }
        else
        {
            _23035 = _9357.x;
        }
        float _23036;
        if (_8449 <= 0.040449999272823333740234375)
        {
            _23036 = _10597.y;
        }
        else
        {
            _23036 = _9357.y;
        }
        float _19167;
        if (_11381 <= 0.040449999272823333740234375)
        {
            _19167 = _10597.z;
        }
        else
        {
            _19167 = _9357.z;
        }
        _6640.x = _23035;
        _6640.y = _23036;
        _6640.z = _19167;
        _11711 = _6640;
        _10247 = _14204;
    }
    else
    {
        _11711 = vec4(input_0.xy, 0.0, 1.0);
        _10247 = _15054;
    }
    vec4 _22401;
    if (_Globals_.bRoughnessMode == 0)
    {
        vec3 _22868 = vec3(_Globals_.g_flWearAmount);
        vec3 _21096 = _19335.xyz;
        float _17632 = _18992.x;
        vec3 _15472 = mix(_21096, _21096 * _Globals_.g_flColorBrightness, vec3(max(_17632, float(_Globals_.g_nColorAdjustmentMode))));
        vec4 _17842;
        _17842.x = _15472.x;
        _17842.y = _15472.y;
        _17842.z = _15472.z;
        vec3 _21103 = mix(mix(mix(_Globals_.g_vColor1, _Globals_.g_vColor3, vec3(pow(_Globals_.g_flWearAmount, 0.5))), mix(_Globals_.g_vColor1, _Globals_.g_vColor2, _22868), vec3(_5609)) * _17842.xyz, _Globals_.g_vColor0 * dot(_17842.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125)), vec3(_8353)).xyz * _8001.xyz;
        vec3 _21271 = normalize(max(vec3(0.0003000000142492353916168212890625), _21103.xyz));
        vec3 _23898 = mix(_Globals_.g_vPaintAlbedoLevels.xyz, _Globals_.g_vMetallicPaintAlbedoLevels.xyz, vec3(_10247));
        _22401 = vec4(mix(mix(_21103, ((_21271.xyz * mix(min(_23898.x, dot((_17842.xyz * _Globals_.g_vColor1).xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))), _23898.z, clamp(pow(max(_21103.x, max(_21103.y, _21103.z)), _23898.y), 0.0, 1.0))) / vec3(max(_21271.x, max(_21271.y, _21271.z)))).xyz, _22868), texture(sampler2D(g_tColor, g_sTrilinearClamp), input_0.xy).xyz, vec3(1.0 - _17632)), 1.0);
    }
    else
    {
        _22401 = _11711;
    }
    vec4 _3401 = texture(sampler2D(g_tGlitterNormal, g_sTrilinearWrap), input_0.xy);
    vec4 _6805;
    if (_3401.w < 0.0)
    {
        vec4 _23135 = _22401;
        _23135.x = _3401.x;
        _23135.y = _3401.y;
        _23135.z = _3401.z;
        _6805 = _23135;
    }
    else
    {
        _6805 = _22401;
    }
    output_0 = _6805;
}


