"""Project the Cathay brushwing and wordmarks onto the aircraft skins."""
from math import pi
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ART = Path(__file__).resolve().parent / "source" / "livery"


def decal_material(name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = True
    material.surface_render_method = "DITHERED"
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = 0.42
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(ART / f"{name}.png"))
    texture.image.pack()
    material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    material.node_tree.links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    return material


def load_a350(path, jade):
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    rotation = Matrix.Rotation(pi / 2, 4, "Z")
    base_texture = bpy.data.images.load(str(ART / "a350-cathay-base.png"))
    base_texture.pack()
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        obj.data.transform(rotation @ obj.matrix_world)
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        for material in obj.data.materials:
            for node in material.node_tree.nodes:
                if node.type == "TEX_IMAGE":
                    node.image = base_texture
        jade_index = len(obj.data.materials)
        obj.data.materials.append(jade)
        for face in obj.data.polygons:
            if face.center.y < -27.2 and face.center.z > 2.7:
                face.material_index = jade_index
    bpy.context.view_layer.update()


def skin_surface():
    vertices, triangles = [], []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("400-style winglet"):
            continue
        offset = len(vertices)
        vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        obj.data.calc_loop_triangles()
        triangles.extend(tuple(offset + idx for idx in t.vertices) for t in obj.data.loop_triangles)
    return BVHTree.FromPolygons(vertices, triangles, all_triangles=True)


def project(surface, label, material, center_y, center_z, width, height, tail=False):
    # Rays run across the fuselage or fin from each side. Following the skin
    # keeps the graphics readable in three-quarter views and at grazing angles.
    nx, nz = 70, 18
    for side in (1, -1):
        vertices, texcoords, faces = [], [], []
        samples = {}
        for j in range(nz + 1):
            v = j / nz
            z = center_z + (v - 0.5) * height
            for i in range(nx + 1):
                u = i / nx
                y = center_y + (u - 0.5) * width * side
                hit, _, _, _ = surface.ray_cast(Vector((40 * side, y, z)), Vector((-side, 0, 0)))
                if hit is None or abs(hit.x) > (1.6 if tail else 4.0):
                    continue
                samples[i, j] = len(vertices)
                vertices.append((hit.x + 0.026 * side, y, z))
                texcoords.append((u, v))
        for j in range(nz):
            for i in range(nx):
                corners = ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))
                if not all(c in samples for c in corners):
                    continue
                ids = [samples[c] for c in corners]
                if max(vertices[k][0] for k in ids) - min(vertices[k][0] for k in ids) < 0.4:
                    faces.append(ids)
        if not faces:
            raise ValueError(f"{label} has no surface on side {side}")
        mesh = bpy.data.meshes.new(label)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        uv = mesh.uv_layers.new(name="Cathay artwork")
        for loop in mesh.loops:
            uv.data[loop.index].uv = texcoords[loop.vertex_index]
        obj = bpy.data.objects.new(label, mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(material)


def apply_cathay(slug, low, high):
    cargo = slug.startswith("747-")
    is_a350 = slug.startswith("a350")
    wordmark = decal_material("cathay-cargo" if cargo else "cathay-pacific")
    brushwing = decal_material("brushwing-white")
    surface = skin_surface()
    length = high.y - low.y
    top = high.z
    if is_a350:
        text_y, text_z = high.y - 15.0, 2.82
        tail_y, tail_z = low.y + 5.0, top - 4.05
    elif cargo:
        text_y, text_z = high.y - 21.0 * length / 76.3, low.z + 4.95
        tail_y, tail_z = low.y + 5.6 * length / 76.3, top - 4.45
    else:
        text_y, text_z = high.y - 15.3, low.z + 7.95
        tail_y, tail_z = low.y + 5.4, top - 3.85
    word_width = 17.2 if cargo else 14.3
    project(surface, "Cathay fuselage branding", wordmark, text_y, text_z, word_width,
            word_width * wordmark.node_tree.nodes.get("Image Texture").image.size[1]
            / wordmark.node_tree.nodes.get("Image Texture").image.size[0])
    project(surface, "Cathay tail brushwing", brushwing, tail_y, tail_z, 3.75, 4.55, tail=True)
