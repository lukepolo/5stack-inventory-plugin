// SPIR-V reflection failed for backend HLSL:
// cbuffer ID 5618 (name: _Globals_), member index 0 (name: g_vTexCoordXform0) cannot be expressed with either HLSL packing layout or packoffset.
//
// Re-attempting reflection with the GLSL backend.

// Source 2 Viewer 19.2.0.0 - https://valveresourceformat.github.io
// SPIR-V source (8148 bytes), GLSL reflection with SPIRV-Cross by KhronosGroup
// Static combos: S_USE_TEST_VALUES

#version 460

struct _1125
{
    uint _m0;
    uint _m1;
    uint _m2;
    uint _m3;
    uint _m4;
    uint _m5;
    uint _m6;
    float _m7;
};

struct _1119
{
    mat3x4 _m0;
};

struct _1126
{
    uint _m0;
    uint _m1;
    uint _m2;
    uint _m3;
    uint _m4;
    uint _m5;
    uint _m6;
    float _m7;
};

struct _1120
{
    mat3x4 _m0;
};

layout(set = 4, binding = 32, std430) readonly buffer g_instanceBuffer
{
    _1126 _m0[];
} g_instanceBuffer_1;

layout(set = 4, binding = 30, std430) readonly buffer g_transformBuffer
{
    _1120 _m0[];
} g_transformBuffer_1;

struct _1565
{
    mat4 _m0;
    mat4 _m1;
    float _m2;
    vec4 _m3;
};

layout(set = 0) uniform _1565 PerViewConstantBuffer_t;

struct _1474
{
    vec4 g_vTexCoordXform0;
    vec4 g_vTexCoordXform1;
    vec2 g_vTexCoordScrollSpeed;
    vec3 g_vColorTint;
    float g_flModelTintAmount;
    vec3 g_vTestGravityDir;
    vec3 g_flLiquidCenterOffset;
};

layout(set = 0) uniform _1474 _Globals_;

struct _1017
{
    vec4 _m0;
};

layout(set = 0) uniform _1017 PerViewConstantBufferCsgo_t;

layout(location = 0) in vec3 vPositionOs;
layout(location = 1) in vec2 vTexCoord;
layout(location = 2) in vec3 vNormalOs;
layout(location = 3) in vec4 vTangentUOs_flTangentVSign;
layout(location = 4) in uvec4 vBlendIndices;
layout(location = 6) in uint nInstanceIdx;
layout(location = 0) out vec3 output_0;
layout(location = 1) out vec3 output_1;
layout(location = 2) out float output_2;
layout(location = 3) out vec3 output_3;
layout(location = 4) out vec3 output_4;
layout(location = 5) out vec3 output_5;
layout(location = 6) out vec4 output_6;
layout(location = 7) out vec4 output_7;
layout(location = 8) out vec3 output_8;
layout(location = 9) out vec3 output_9;
layout(location = 10) out vec4 output_10;
layout(location = 11) centroid out vec4 output_11;
layout(location = 12) centroid out vec3 output_12;
layout(location = 13) out vec4 output_13;
layout(location = 14) flat out uint output_14;

void main()
{
    _1125 _20228;
    _20228._m0 = g_instanceBuffer_1._m0[nInstanceIdx]._m0;
    _20228._m1 = g_instanceBuffer_1._m0[nInstanceIdx]._m1;
    _20228._m2 = g_instanceBuffer_1._m0[nInstanceIdx]._m2;
    _20228._m3 = g_instanceBuffer_1._m0[nInstanceIdx]._m3;
    _20228._m4 = g_instanceBuffer_1._m0[nInstanceIdx]._m4;
    _20228._m5 = g_instanceBuffer_1._m0[nInstanceIdx]._m5;
    _20228._m6 = g_instanceBuffer_1._m0[nInstanceIdx]._m6;
    _20228._m7 = g_instanceBuffer_1._m0[nInstanceIdx]._m7;
    uint _16987 = (_20228._m5 >> uint(16)) & 15u;
    bool _21645 = _16987 == 1u;
    uint _21709;
    if (_21645)
    {
        _21709 = _20228._m1 + (2u + vBlendIndices.x);
    }
    else
    {
        _21709 = _20228._m1;
    }
    _1119 _21957;
    _21957._m0 = g_transformBuffer_1._m0[_21709]._m0;
    vec3 _19321;
    if (_16987 > 0u)
    {
        _1119 _20229;
        _20229._m0 = g_transformBuffer_1._m0[_20228._m1]._m0;
        _19321 = vec3(_20229._m0[0].z);
    }
    else
    {
        _19321 = vec3(1.0);
    }
    vec4 _23812 = vec4(uvec4(_20228._m0 & 255u, (_20228._m0 & 65280u) >> uint(8), (_20228._m0 & 16711680u) >> uint(16), (_20228._m0 & 4278190080u) >> uint(24))) * vec4(0.0039215688593685626983642578125);
    vec3 _6253 = _23812.xyz;
    vec3 _17828 = _6253 * vec3(0.077399380505084991455078125);
    vec3 _7676 = pow((_6253 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
    float _21354;
    if (_23812.x <= 0.040449999272823333740234375)
    {
        _21354 = _17828.x;
    }
    else
    {
        _21354 = _7676.x;
    }
    float _21355;
    if (_23812.y <= 0.040449999272823333740234375)
    {
        _21355 = _17828.y;
    }
    else
    {
        _21355 = _7676.y;
    }
    float _17978;
    if (_23812.z <= 0.040449999272823333740234375)
    {
        _17978 = _17828.z;
    }
    else
    {
        _17978 = _7676.z;
    }
    float _7654 = _23812.w;
    vec3 _11179 = normalize(vec4(vNormalOs.xyz, 0.0) * _21957._m0);
    vec3 _12151 = vec4(vPositionOs.xyz * _19321.xyz, 1.0) * _21957._m0;
    vec4 _16665 = vec4(_12151.xyz, 1.0);
    vec4 _18237 = (_16665 + (PerViewConstantBuffer_t._m3 * 1.0)).xyzw * PerViewConstantBuffer_t._m0;
    vec4 _9360 = vTexCoord.xyxy;
    _9360.x = dot(vTexCoord.xy, _Globals_.g_vTexCoordXform0.xy) + _Globals_.g_vTexCoordXform0.w;
    _9360.y = dot(vTexCoord.xy, _Globals_.g_vTexCoordXform1.xy) + _Globals_.g_vTexCoordXform1.w;
    vec2 _22490 = _9360.xy + (_Globals_.g_vTexCoordScrollSpeed.xy * PerViewConstantBuffer_t._m2);
    vec4 _20488 = _9360;
    _20488.x = _22490.x;
    _20488.y = _22490.y;
    vec4 _11399 = vec4(mix(vec3(1.0), vec4(_21354, _21355, _17978, _7654).xyz, vec3(_Globals_.g_flModelTintAmount)), _7654 * _20228._m7);
    vec3 _13062 = _11399.xyz * _Globals_.g_vColorTint.xyz;
    float _12758 = _13062.x;
    vec4 _23714 = _11399;
    _23714.x = _12758;
    _23714.y = _13062.y;
    _23714.z = _13062.z;
    uint _21710;
    if (_21645)
    {
        _21710 = _20228._m1 + (2u + vBlendIndices.x);
    }
    else
    {
        _21710 = _20228._m1;
    }
    _1119 _19924;
    _19924._m0 = g_transformBuffer_1._m0[_21710]._m0;
    vec3 _8077 = vec4(_Globals_.g_flLiquidCenterOffset, 1.0) * _19924._m0;
    vec3 _19648;
    if (length(_Globals_.g_vTestGravityDir) > 0.0)
    {
        _19648 = normalize(_Globals_.g_vTestGravityDir);
    }
    else
    {
        _19648 = vec3(0.0, 0.0, -1.0);
    }
    output_0 = vPositionOs - _Globals_.g_flLiquidCenterOffset;
    output_1 = _8077;
    output_2 = fract((PerViewConstantBuffer_t._m2 + _12758) * 0.004999999888241291046142578125) * 200.0;
    output_3 = vec4(0.0, 0.0, 1.0, 0.0) * _19924._m0;
    output_4 = _19648;
    output_5 = (vec4(_19648.xyz, 0.0).xyzw * PerViewConstantBuffer_t._m1).xyz;
    output_6 = _16665.xyzw * PerViewConstantBuffer_t._m1;
    output_7 = vec4(_8077.xyz, 1.0).xyzw * PerViewConstantBuffer_t._m1;
    output_8 = _12151.xyz - PerViewConstantBufferCsgo_t._m0.xyz;
    output_9 = _11179;
    output_10 = _20488;
    output_11 = _23714;
    output_12 = _11179;
    output_13 = vec4(normalize(vec4(vTangentUOs_flTangentVSign.xyz, 0.0) * _21957._m0), vTangentUOs_flTangentVSign.w);
    output_14 = _20228._m5 & 65535u;
    _18237.y = -_18237.y;
    gl_Position = _18237;
}



