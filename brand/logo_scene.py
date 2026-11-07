"""Urban Eclipse logo as a clay miniature: the TV tower on a round tile of Berlin, the sun ringed
round its sphere. Run: Blender -b -P brand/logo_scene.py -- <out.png> <variant: light|night|clear> [samples]"""
import bpy, math, random, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
VARIANT = argv[1] if len(argv) > 1 else 'light'
SAMPLES = int(argv[2]) if len(argv) > 2 else 96
SHOT = argv[3] if len(argv) > 3 else 'tile'  # tile: the whole miniature; icon: the sphere close up
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.film_transparent = True
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'


def mat(name, rgb, rough=0.85, emit=None, strength=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


CLAY = mat('clay', srgb('#efe9df'))
GROUND = mat('ground', srgb('#d3c9ba'))
PARK = mat('park', srgb('#7fa45a'))
WATER = mat('water', srgb('#5a8cba'), rough=0.25)
TOWER = mat('tower', srgb('#f4efe7'), rough=0.7)
WINDOW = mat('window', srgb('#5d6270'), rough=0.3)
SUN = mat('sun', (0, 0, 0), emit=srgb('#ff6c0a'), strength=1.9)


def add(obj, m):
    obj.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return obj


def bevel(obj, w=0.012):
    mod = obj.modifiers.new('bevel', 'BEVEL')
    mod.width = w
    mod.segments = 3


# The tile: a round slab of city, 2.4 across (1 unit = 100 m).
bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=1.6, depth=0.18, location=(0, 0, -0.09))
tile = add(bpy.context.object, GROUND)
bevel(tile, 0.03)
R = 1.52

TX, TY = 0.0, 0.17

# The Spree, a band across the front.
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.62, 0.004))
river = bpy.context.object
river.scale = (3, 0.26, 0.01)
river.rotation_euler.z = math.radians(-12)
add(river, WATER)
bpy.ops.object.transform_apply(scale=True, rotation=True)
# Trim river to the tile with a boolean intersect.
bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=R + 0.04, depth=0.2)
cutter = bpy.context.object
b = river.modifiers.new('clip', 'BOOLEAN')
b.operation = 'INTERSECT'
b.object = cutter
bpy.context.view_layer.objects.active = river
bpy.ops.object.modifier_apply(modifier='clip')
bpy.data.objects.remove(cutter)

# A park round the tower's foot.
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.3, depth=0.012, location=(TX, TY, 0.006))
add(bpy.context.object, PARK)


def river_y(x):
    return -0.72 - math.tan(math.radians(-12)) * x * -1


# Blocks of the city: Berlin's perimeter blocks round courtyards, on a street grid, kept clear
# of the river, the park and the tile's edge; now and then a park block.
CELL = 0.34
for gx in range(-5, 6):
    for gy in range(-5, 6):
        x, y = gx * CELL, gy * CELL
        w, d = CELL - 0.05 + random.uniform(-0.015, 0.0), CELL - 0.05 + random.uniform(-0.015, 0.0)
        if math.hypot(abs(x) + w / 2, abs(y) + d / 2) > R - 0.06:
            continue
        if abs(y - (-0.62 + math.tan(math.radians(12)) * x)) < 0.27:
            continue
        if math.hypot(x - TX, y - TY) < 0.36:
            continue
        if random.random() < 0.08:
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, 0.008))
            o = bpy.context.object
            o.scale = (w, d, 0.016)
            add(o, PARK)
            continue
        h = random.choice([0.13, 0.15, 0.16, 0.18])
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, h / 2))
        o = bpy.context.object
        o.scale = (w, d, h)
        bpy.ops.object.transform_apply(scale=True)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, h / 2 + 0.02))
        hole = bpy.context.object
        hole.scale = (w - 0.13, d - 0.13, h + 0.1)
        m = o.modifiers.new('court', 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.object = hole
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='court')
        bpy.data.objects.remove(hole)
        bevel(o, 0.006)
        o.select_set(True)
        add(o, CLAY)
        if random.random() < 0.12:  # a taller corner house
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x + w / 2 - 0.05, y + d / 2 - 0.05, h * 0.8))
            t = bpy.context.object
            t.scale = (0.1, 0.1, h * 1.6)
            bevel(t, 0.006)
            add(t, CLAY)

# The TV tower: shaft 32 m → 9 m wide up to 250 m, sphere 32 m across at 212 m, antenna to 368 m.
bpy.ops.mesh.primitive_cone_add(vertices=64, radius1=0.12, radius2=0.045, depth=2.5, location=(TX, TY, 1.25))
add(bpy.context.object, TOWER)
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=0.17, location=(TX, TY, 2.12))
add(bpy.context.object, TOWER)
# The windows' band round the sphere.
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.171, depth=0.035, location=(TX, TY, 2.15))
add(bpy.context.object, WINDOW)
bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.035, radius2=0.012, depth=1.2, location=(TX, TY, 2.5 + 0.6))
add(bpy.context.object, TOWER)
# Its foot: the folded pavilion, simplified to a low ring.
bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.3, depth=0.07, location=(TX, TY, 0.035))
o = add(bpy.context.object, CLAY)
bevel(o, 0.01)

# Camera: low across the river, looking up at the sphere.
SPHERE = Vector((TX, TY, 2.12))
cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 85
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
cam.location = Vector((3.6, -10.6, 4.4))
look_at = Vector((TX, TY, 1.45))
if SHOT == 'icon':
    cam_data.lens = 330
    look_at = Vector((TX, TY, 2.2))
cam.rotation_euler = (look_at - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

# The sun: a glowing disc far behind the sphere on the camera's line, a little larger than it,
# so the sphere leaves a ring of light.
d = (SPHERE - cam.location).normalized()
dist_sphere = (SPHERE - cam.location).length
far = 40
sun_pos = cam.location + d * far
sun_r = 0.17 * far / dist_sphere * 1.42
bpy.ops.mesh.primitive_circle_add(vertices=128, radius=sun_r, fill_type='NGON', location=sun_pos)
disc = bpy.context.object
disc.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
disc.data.materials.append(SUN)
disc.visible_shadow = False

# A soft halo round the sun: emission fading to transparent towards its rim.
halo_m = bpy.data.materials.new('halo')
halo_m.use_nodes = True
halo_m.blend_method = 'BLEND' if hasattr(halo_m, 'blend_method') else None
nt = halo_m.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
out = nt.nodes.new('ShaderNodeOutputMaterial')
mix = nt.nodes.new('ShaderNodeMixShader')
tr = nt.nodes.new('ShaderNodeBsdfTransparent')
em = nt.nodes.new('ShaderNodeEmission')
em.inputs['Color'].default_value = (*srgb('#ff9a40'), 1)
em.inputs['Strength'].default_value = 3
tc = nt.nodes.new('ShaderNodeTexCoord')
grad = nt.nodes.new('ShaderNodeTexGradient')
grad.gradient_type = 'SPHERICAL'
mp = nt.nodes.new('ShaderNodeMapping')
mp.inputs['Scale'].default_value = (1, 1, 1)
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
ramp.color_ramp.elements[1].position = 1.0
ramp.color_ramp.elements[1].color = (0.75, 0.75, 0.75, 1)
ramp.color_ramp.interpolation = 'EASE'
nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
nt.links.new(mp.outputs['Vector'], grad.inputs['Vector'])
nt.links.new(grad.outputs['Fac'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], mix.inputs['Fac'])
nt.links.new(tr.outputs[0], mix.inputs[1])
nt.links.new(em.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], out.inputs['Surface'])
HALO_R = sun_r * 3.2
bpy.ops.mesh.primitive_circle_add(vertices=128, radius=1, fill_type='NGON', location=cam.location + d * (far + 1))
halo = bpy.context.object
halo.scale = (HALO_R, HALO_R, HALO_R)
halo.rotation_euler = disc.rotation_euler
halo.data.materials.append(halo_m)
halo.visible_shadow = False

# Light: warm low sun from behind and to the side (rim), soft sky fill.
sun_data = bpy.data.lights.new('sunlight', 'SUN')
sun_data.energy = 5.5
sun_data.angle = math.radians(4)
sun_data.color = srgb('#ffcf9a')
sun = bpy.data.objects.new('sunlight', sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(66), 0, math.radians(-25))

world = bpy.data.worlds.new('w')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
if VARIANT == 'night':
    bg.inputs['Color'].default_value = (*srgb('#1a2540'), 1)
    bg.inputs['Strength'].default_value = 0.9
    sun_data.energy = 0.6
    sun_data.color = srgb('#9fb4ff')
    WINDOW.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (*srgb('#ffc77a'), 1)
    WINDOW.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 3
else:
    bg.inputs['Color'].default_value = (*srgb('#f6ebdd'), 1)
    bg.inputs['Strength'].default_value = 0.55

# Glow round the sun in the compositor (Blender 5: a compositing node group).
try:
    tree = bpy.data.node_groups.new('comp', 'CompositorNodeTree')
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    scene.compositing_node_group = tree
    rl = tree.nodes.new('CompositorNodeRLayers')
    out = tree.nodes.new('NodeGroupOutput')
    glare = tree.nodes.new('CompositorNodeGlare')
    for k, v in (('Type', 'Fog Glow'), ('Quality', 'High')):
        if k in glare.inputs:
            glare.inputs[k].default_value = v
    for k, v in (('Size', 0.75), ('Strength', 1.2), ('Threshold', 1.0)):
        if k in glare.inputs:
            glare.inputs[k].default_value = v
    tree.links.new(rl.outputs['Image'], glare.inputs['Image'])
    tree.links.new(glare.outputs['Image'], out.inputs[0])
except Exception as e:
    print('no glare:', e)

scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('wrote', OUT)
