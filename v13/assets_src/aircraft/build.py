"""Build and repaint the RELAY v13 aircraft models."""
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
SOURCES = ROOT / "source"
MODELS = ROOT / "models"
PREVIEWS = ROOT / "previews"
STATIC_MODELS = ROOT.parents[1] / "static" / "assets" / "aircraft"
sys.path.insert(0, str(ROOT))
from livery import apply_cathay, load_a350

PALETTE = {
    "Fuselage white": ((0.87, 0.90, 0.89, 1), 0.34, 0.08),
    "Jade": ((0.006, 0.125, 0.113, 1), 0.35, 0.10),
    "Wing grey": ((0.44, 0.48, 0.50, 1), 0.43, 0.18),
    "Glazing": ((0.025, 0.047, 0.061, 1), 0.23, 0.17),
    "Metal": ((0.32, 0.37, 0.40, 1), 0.32, 0.49),
    "Tyres": ((0.024, 0.027, 0.028, 1), 0.75, 0.0),
}


def make_materials():
    materials = {}
    for name, (color, roughness, metal) in PALETTE.items():
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = color
        mat.use_nodes = True
        shader = mat.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Base Color"].default_value = color
        shader.inputs["Metallic"].default_value = metal
        shader.inputs["Roughness"].default_value = roughness
        materials[name] = mat
    return materials


EXTERIOR_777 = re.compile(
    r"^(?:fuselage(?:$|\.00[1-8]$|raccord)|wings|tail$|rudder$|lrudder$|"
    r"[lr]hstab|[lr](?:flap|aileron|slat|elevator)|"
    r"frt(?:gear|strut|wheel)|[lr](?:gear|hwheel|axle|strut|bdamper)|"
    r"[lr](?:main\.geardoor|wing\.geardoor|[fr]door)|"
    r"entry[1-5][lr](?:$|\.001$)|entry[89]r(?:$|\.001$)|"
    r"lhe?ngchrome$|[lr]fan$|moteur[23]$|reversers|"
    r"glassehublot|window mix exterieur|queu pointe|apud$|apug$)", re.I,
)
INTERIOR_747 = re.compile(
    r"^(?:lav|cockpitdoor|cockpitshell|cargodoor_in|asas|flap_compart|"
    r"flg_.*\.in$|nlg_.*\.in$)", re.I,
)


def ac_objects(path):
    # AC3D is a tree. Apply inherited transforms while retaining part names.
    lines = iter(path.read_text(encoding="latin1").splitlines())
    for line in lines:
        if line.startswith("OBJECT "):
            break

    def read_object(parent_transform):
        from mathutils import Matrix
        rotation = Matrix.Identity(3)
        location = Vector((0, 0, 0))
        name, texture, vertices, faces, smooth, uvs = "", "", [], [], [], []
        for line in lines:
            key, _, value = line.partition(" ")
            if key == "name":
                name = value.strip('"')
            elif key == "texture":
                texture = value.strip('"')
            elif key == "loc":
                location = Vector(tuple(map(float, value.split())))
            elif key == "rot":
                nums = list(map(float, value.split()))
                rotation = Matrix([nums[i:i+3] for i in range(0, 9, 3)])
            elif key == "numvert":
                vertices = [tuple(map(float, next(lines).split()[:3])) for _ in range(int(value))]
            elif key == "numsurf":
                for _ in range(int(value)):
                    flags = int(next(lines).split()[1], 16)
                    refs = next(lines)
                    while not refs.startswith("refs "):
                        refs = next(lines)
                    corners = [next(lines).split() for _ in range(int(refs.split()[1]))]
                    indices = [int(corner[0]) for corner in corners]
                    if flags & 0xf == 0 and len(set(indices)) == len(indices) and len(indices) >= 3:
                        faces.append(indices)
                        smooth.append(bool(flags & 0x10))
                        uvs.append([tuple(map(float, corner[1:3])) for corner in corners])
            elif key == "kids":
                transform = rotation.to_4x4()
                transform.translation = location
                transform = parent_transform @ transform
                if faces:
                    yield name, texture, [transform @ Vector(v) for v in vertices], faces, smooth, uvs
                for _ in range(int(value)):
                    if not next(lines).startswith("OBJECT "):
                        raise ValueError(f"Expected a child object in {path}")
                    yield from read_object(transform)
                return

    from mathutils import Matrix
    yield from read_object(Matrix.Identity(4))


def paint(name, texture):
    name = name.lower()
    if any(word in name for word in ("wheel", "tyre", "tire")):
        return "Tyres"
    if any(word in name for word in ("window", "glasse", "windshield")):
        return "Glazing"
    if name in ("tail", "vstab", "rudder", "rudder_1", "lrudder"):
        return "Jade"
    if any(word in name for word in ("blades", "fan", "intake", "chrome", "axle", "strut", "pin_")) and "capa" not in name:
        return "Metal"
    if texture == "wings.png" or re.match(r"^(wing|[lr](hstab|flap|slat|aileron)|hstab|elevator)", name):
        return "Wing grey"
    return "Fuselage white"


def mesh_object(name, vertices, faces, material, smooth, uvs=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    for polygon, flag in zip(mesh.polygons, smooth):
        polygon.use_smooth = flag
    if uvs:
        layer = mesh.uv_layers.new(name="AC3D UVs")
        for polygon, corners in zip(mesh.polygons, uvs, strict=True):
            for index, uv in zip(polygon.loop_indices, corners, strict=True):
                layer.data[index].uv = uv
    return obj


def mean_bounds(objects):
    xyz = [obj.matrix_world @ v.co for obj in objects for v in obj.data.vertices]
    return (
        Vector(tuple(min(v[i] for v in xyz) for i in range(3))),
        Vector(tuple(max(v[i] for v in xyz) for i in range(3))),
    )


def build_boeing(source, slug, materials):
    is_777 = source == "777-300er"
    for name, texture, vertices, faces, smooth, _ in ac_objects(SOURCES / f"{source}.ac"):
        if is_777 and not EXTERIOR_777.match(name):
            continue
        if not is_777 and INTERIOR_747.match(name):
            continue
        # AC3D Y-up, nose -X. Blender Z-up, nose +Y.
        vertices = [(v.z, -v.x, v.y) for v in vertices]
        mesh_object(name, vertices, faces, materials[paint(name, texture)], smooth)
    if slug == "747-400erf-visual-proxy":
        # Reshape the 8F exterior towards the shorter 400F silhouette.
        for obj in bpy.context.scene.objects:
            for v in obj.data.vertices:
                v.co.y *= 70.7 / 76.3
                v.co.x *= 64.4 / 68.4
        for side in (-1, 1):
            outer = [v.co for obj in bpy.context.scene.objects for v in obj.data.vertices
                     if v.co.x * side > 31.2]
            tip = max(v.x * side for v in outer)
            tip_vertices = [v for v in outer if v.x * side > tip - 0.55]
            leading = max(tip_vertices, key=lambda v: v.y).copy()
            trailing = min(tip_vertices, key=lambda v: v.y).copy()
            leading.z -= 0.07
            trailing.z -= 0.07
            root = trailing.lerp(leading, 0.3)
            top_trailing = root + Vector((side * 0.08, -0.85, 1.8))
            top_leading = top_trailing + Vector((0, 0.82, 0.12))
            vertices = [leading, trailing, top_trailing, top_leading]
            mesh_object("400-style winglet", vertices,
                        [(0, 1, 2, 3), (3, 2, 1, 0)], materials["Jade"], [False, False])



def build_a330(materials):
    source = SOURCES / "a330"
    textures = {
        "323_blank.png": "343_blank.png",
        "343_blank.png": "343_blank.png",
        "wings_main.png": "wings_main.png",
        "wings_tail.png": "wings_tail.png",
        "windshield_pane.png": "windshield_pane.png",
    }
    textured = {}
    for filename in sorted(set(textures.values())):
        material = materials["Fuselage white"].copy()
        material.name = f"A330 {Path(filename).stem}"
        nodes = material.node_tree.nodes
        image = nodes.new("ShaderNodeTexImage")
        image.image = bpy.data.images.load(str(source / filename))
        image.image.pack()
        shader = nodes.get("Principled BSDF")
        material.node_tree.links.new(image.outputs["Color"], shader.inputs["Base Color"])
        textured[filename] = material

    for filename in ("a330-300-main.ac", "trent772b-60.ac"):
        for name, texture, vertices, faces, smooth, uvs in ac_objects(source / filename):
            if name.startswith(("slat.in.open", "sphere")):
                continue
            key = name.lower()
            if key.startswith(("vstab", "rudder", "winglet")):
                material = materials["Jade"]
            elif texture == "windshield.png":
                material = materials["Glazing"]
            elif key == "intake" or key.startswith(("rr.exhaust", "fan", "pw.nacelle")):
                material = materials["Metal"]
            elif texture in textures:
                material = textured[textures[texture]]
            elif texture == "landing-gears.png":
                material = materials["Tyres" if "wheel" in key else "Metal"]
            else:
                material = materials[paint(name, texture)]
            # AC3D Y-up, nose -X. Blender Z-up, nose +Y.
            mesh_object(name, [(-v.z, -v.x, v.y) for v in vertices], faces,
                        material, smooth, uvs)


def export_model(slug, source_path, model_path):
    scene = bpy.context.scene
    objects = [obj for obj in scene.objects if obj.type == "MESH"]
    low, high = mean_bounds(objects)
    apply_cathay(slug, low, high)
    objects = [obj for obj in scene.objects if obj.type == "MESH"]
    center = (low + high) * 0.5
    for obj in objects:
        obj.location += Vector((-center.x, -center.y, -low.z))
    bpy.context.view_layer.update()
    # Join by material for the browser export, preserving named source parts in the blend.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), compress=True)
    parts_by_material = {}
    for obj in objects:
        parts_by_material.setdefault(obj.data.materials[0], []).append(obj)
    for material, parts in parts_by_material.items():
        if len(parts) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in parts:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        bpy.context.object.name = material.name
    bpy.ops.export_scene.gltf(filepath=str(model_path), export_format="GLB",
                              export_cameras=False, export_lights=False)


def render_preview(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    low, high = mean_bounds(meshes)
    center = (low + high) * 0.5
    size = max(high - low)
    # Use the model's length axis for a consistent three-quarter angle.
    camera_dir = Vector((1.0, 0.69, 0.56))
    bpy.ops.object.camera_add(location=center + camera_dir * size * 1.45)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = size * 1.23
    camera.data.clip_end = size * 20
    scene.camera = camera
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = 0.6

    bpy.ops.mesh.primitive_plane_add(size=size * 200, location=(center.x, center.y, low.z - size * 0.002))
    ground = bpy.data.materials.new("Preview backdrop")
    ground.diffuse_color = (0.105, 0.145, 0.175, 1)
    bpy.context.object.data.materials.append(ground)
    world = bpy.data.worlds.new("Preview lighting")
    world.use_nodes = True
    world.node_tree.nodes.get("Background").inputs[0].default_value = (0.45, 0.55, 0.69, 1)
    world.node_tree.nodes.get("Background").inputs[1].default_value = 0.46
    scene.world = world
    for location, energy, width in (((-0.5, 0.2, 1.0), 360, 0.65),
                                    ((0.4, -0.6, 0.6), 190, 0.85)):
        bpy.ops.object.light_add(type="AREA", location=center + Vector(location) * size)
        light = bpy.context.object
        light.rotation_euler = (center-light.location).to_track_quat("-Z", "Y").to_euler()
        light.data.energy = energy * size**2 / 100
        light.data.shape = "DISK"
        light.data.size = width * size
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 10
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 900
    scene.render.resolution_y = 580
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(PREVIEWS / f"{path.stem}.png")
    bpy.ops.render.render(write_still=True)
    print(f"Verified {path.name}: {len(meshes)} meshes, bounds {tuple(round(v, 2) for v in high-low)}")


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    targets = (("777-300er", "777-300er"), ("747-8f", "747-8f"),
               ("747-8f", "747-400erf-visual-proxy"), (None, "a350-generic-cathay"),
               ("IDG-A33X", "a330-300-cathay"))
    selected = {arg for arg in args if not arg.startswith("--")}
    if selected:
        targets = tuple(target for target in targets if target[1] in selected)
        if selected != {slug for _, slug in targets}:
            raise ValueError(f"Unknown aircraft selection: {selected}")
    for source, slug in targets:
        source_dir, model_dir = SOURCES, MODELS
        if source == "IDG-A33X":
            source_dir, model_dir = ROOT, STATIC_MODELS
        model_path = model_dir / f"{slug}.glb"
        if "--render-only" not in args:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            materials = make_materials()
            if source is None:
                load_a350(SOURCES / "a350-amvlab-original.glb", materials["Jade"])
            elif source == "IDG-A33X":
                build_a330(materials)
            else:
                build_boeing(source, slug, materials)
            export_model(slug, source_dir / f"{slug}.blend", model_path)
        if "--no-renders" not in args and model_path.is_file():
            PREVIEWS.mkdir(exist_ok=True)
            render_preview(model_path)


if __name__ == "__main__":
    main()
