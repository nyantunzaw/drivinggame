// Shared materials. Kept in one place so night-time updates touch every user.
import * as THREE from 'three';
import * as T from '../textures.js';
import { facadeTextures, signTexture, FACADE } from '../facades.js';

export async function createMaterials(renderer, qualityName = 'high', opts = {}) {
  const facade = facadeTextures(qualityName);
  const M = {};

  // Buildings: facade atlas. uv.x = style*1000 + u (u counts groups of 4 bays of 3.6 m),
  // uv.y = height above ground in floors (3.3 m); the ground floor gets its own row
  // (shop fronts), floors above cycle through three rows. uv.y < -0.5 = untextured
  // (roofs, parapets, awnings, rooftop clutter) coloured by vertex colour only.
  M.building = new THREE.MeshLambertMaterial({
    map: facade.map, emissiveMap: facade.emissive, emissive: 0xffffff, emissiveIntensity: 0,
    vertexColors: true,
  });
  const RS = `vec2(${(FACADE.RW / FACADE.SIZE).toFixed(6)}, ${(FACADE.RH / FACADE.SIZE).toFixed(6)})`;
  const atlasUv = /* glsl */`
        bool fRoof = vMapUv.y < -0.5;
        float fStyle = floor(vMapUv.x / 1000.0);
        float fU = vMapUv.x - fStyle * 1000.0;
        float fFloor = floor(vMapUv.y);
        float fRow = fFloor < 0.5 ? 0.0 : 1.0 + mod(fFloor - 1.0, 3.0);
        float fV = (fRow + fract(vMapUv.y)) * 0.25;
        vec2 fRS = ${RS};
        vec2 fCell = vec2(mod(fStyle, 3.0), floor(fStyle / 3.0));
        vec2 fUv = vec2((fCell.x + fract(fU)) * fRS.x, 1.0 - (fCell.y + 1.0 - fV) * fRS.y);`;
  // shopfronts: a warm, dimmer glow than upstairs windows, darkest down at the pavement
  const shopGlow = 'if (fRow < 0.5) totalEmissiveRadiance *= vec3(0.62, 0.52, 0.4) * (0.55 + 0.45 * fract(vMapUv.y));';
  // Full version: explicit gradients so mip selection ignores the wrap-around seams.
  const facadeFull = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', /* glsl */`${atlasUv}
        vec2 fGx = vec2(dFdx(fU) * fRS.x, dFdx(vMapUv.y) * 0.25 * fRS.y);
        vec2 fGy = vec2(dFdy(fU) * fRS.x, dFdy(vMapUv.y) * 0.25 * fRS.y);
        if (!fRoof) diffuseColor *= textureGrad(map, fUv, fGx, fGy);
      `)
      .replace('#include <emissivemap_fragment>', /* glsl */`
        totalEmissiveRadiance *= fRoof ? vec3(0.0) : textureGrad(emissiveMap, fUv, fGx, fGy).rgb;
        ${shopGlow}
      `);
  };
  // Compatibility version (WebGL1, fussy drivers): plain lookups, faint seams between bays.
  const facadeSimple = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', /* glsl */`${atlasUv}
        vec4 fTex = texture2D(map, fUv);
        vec3 fEmi = texture2D(emissiveMap, fUv).rgb;
        if (!fRoof) diffuseColor *= fTex;
      `)
      .replace('#include <emissivemap_fragment>', /* glsl */`
        totalEmissiveRadiance *= fRoof ? vec3(0.0) : fEmi;
        ${shopGlow}
      `);
  };
  M.useSimpleFacade = () => {
    M.building.onBeforeCompile = facadeSimple;
    M.building.customProgramCacheKey = () => 'building-atlas-simple';
    M.building.needsUpdate = true;
  };
  M.building.onBeforeCompile = facadeFull;
  M.building.customProgramCacheKey = () => 'building-atlas';
  if (opts.simpleFacade || !renderer.capabilities.isWebGL2) M.useSimpleFacade();

  const asphalt = T.asphaltTexture();
  M.road = new THREE.MeshLambertMaterial({
    map: asphalt, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });

  M.marking = new THREE.MeshLambertMaterial({
    map: T.markingTexture(), vertexColors: true, alphaTest: 0.5, transparent: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  });

  // Props (trees, lamp posts): vertex colours + per-vertex glow for lamp bulbs.
  M.props = new THREE.MeshLambertMaterial({ vertexColors: true });
  M.propsNight = { value: 0 };
  M.props.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = M.propsNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * (0.12 + uNight * 2.4);');
  };
  M.props.customProgramCacheKey = () => 'props-glow';

  // Shop signs (Chinese / Burmese / English), glowing like neon after dark.
  const signs = await signTexture();
  M.signs = new THREE.MeshLambertMaterial({ map: signs, emissiveMap: signs, emissive: 0xffffff, emissiveIntensity: 0, side: THREE.DoubleSide });
  M.wires = new THREE.LineBasicMaterial({ color: 0x1b1b1d });

  M.pool = new THREE.MeshBasicMaterial({
    map: T.glowTexture(), color: 0xffc777, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10,
  });

  const groundTex = T.groundTexture();
  M.ground = new THREE.MeshLambertMaterial({ map: groundTex });
  M.grass = new THREE.MeshLambertMaterial({ map: T.grassTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  M.forest = new THREE.MeshLambertMaterial({ map: T.grassTexture(), color: 0x9bbf8a, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  M.pitch = new THREE.MeshLambertMaterial({ map: T.grassTexture(), color: 0xc8ffb0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  M.plaza = new THREE.MeshLambertMaterial({ map: T.plazaTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });

  const wn = T.waterNormalTexture();
  M.water = new THREE.MeshPhongMaterial({
    color: 0x2f6f73, specular: 0xffffff, shininess: 90, normalMap: wn, normalScale: new THREE.Vector2(0.6, 0.6),
    transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -3,
  });
  M.waterNormal = wn;

  M.rail = new THREE.MeshLambertMaterial({ color: 0x5b5048, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  M.steel = new THREE.MeshLambertMaterial({ color: 0x9a9aa0 });

  // Gold for pagodas: physically based with a warm environment.
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envGeo = new THREE.SphereGeometry(10, 32, 16);
  const envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y;
      vec3 c = mix(vec3(0.55,0.42,0.3), vec3(0.95,0.85,0.75), smoothstep(-0.3,0.2,h));
      c = mix(c, vec3(0.45,0.65,0.95), smoothstep(0.2,0.9,h));
      gl_FragColor = vec4(c,1.); }`,
  });
  envScene.add(new THREE.Mesh(envGeo, envMat));
  M.env = pm.fromScene(envScene, 0.02).texture;
  pm.dispose();

  const gold = T.goldTexture();
  gold.repeat.set(4, 4);
  M.gold = new THREE.MeshStandardMaterial({
    color: 0xffcf5a, map: gold, metalness: 0.9, roughness: 0.28, envMap: M.env, envMapIntensity: 1.2,
    emissive: 0xff9a1a, emissiveIntensity: 0,
  });
  M.gold.onBeforeCompile = (shader) => {
    // Pagodas glow through the haze from across the city.
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>',
      '#ifdef USE_FOG\n float fogFactor = smoothstep( fogNear * 2.5, fogFar * 4.0, vFogDepth );\n gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );\n#endif');
  };
  M.whiteStone = new THREE.MeshLambertMaterial({ color: 0xf2eee4 });
  M.whiteStone.onBeforeCompile = M.gold.onBeforeCompile;
  M.redRoof = new THREE.MeshLambertMaterial({ color: 0x8a2f24 });
  M.landmarkVC = new THREE.MeshLambertMaterial({ vertexColors: true });
  M.landmarkVC.onBeforeCompile = M.gold.onBeforeCompile;

  M.setNight = (night, daylight) => {
    M.building.emissiveIntensity = night * 0.95;
    M.signs.emissiveIntensity = 0.08 + night * 1.1;
    M.propsNight.value = night;
    M.pool.opacity = night * 0.55;
    M.gold.emissiveIntensity = night * 0.55;
    M.gold.envMapIntensity = 0.35 + daylight * 0.9;
  };
  return M;
}
