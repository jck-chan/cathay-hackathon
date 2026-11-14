# RELAY v13 Cathay-liveried aircraft

| GLB | Source and author | License and changes |
| --- | --- | --- |
| a330-300.glb | [Cathay Pacific Airbus A330-300](https://sketchfab.com/3d-models/cathay-pacific-airbus-a330-300-45a62d88607145c4afb1f46b281aa277), OUTPISTON. Extracted from the supplied local archive. | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Original GLB and livery. Local-use copy excluded from Git. The local Cathay fleet ZIP includes this model under its original license. Noncommercial sharing under the license requires attribution, and adaptations must use the same license. Competition and Cathay mark permissions were unverified. |
| a350-generic-cathay.glb | [A350_nologo.glb](https://github.com/amvlab/aircraft-models/blob/main/models/A350_nologo.glb), amvlab. | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Jade tail, white rear fuselage, brushwing and Cathay Pacific markings added. Centered and aligned nose-forward. Generic A350 airframe with unverified exact subtype. |
| 777-300er.glb | [Boeing 777-300ER AC3D exterior](https://github.com/franck-vmd/Boeing-777-Flightgear/tree/cfa61378d1210a33e0520d4459d0baf1cf1511f5/777-VMD/Models/Liveries-300ER), Franck VMD and FlightGear contributors listed in `source/777-AUTHORS`. | [GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html). Selected exterior parts, replaced textures with white, grey and jade materials, added Cathay Pacific markings, grounded and centered, merged GLB meshes by material. |
| 747-8f.glb | [FlightGear 747-8F](https://github.com/LincolnWorks-FlightGear/747-8i/tree/322e77bb5a454e04faea5cae6df2dd1daa9187f5), John Williams and LincolnWorks with Grupo FGBr, Gijs de Rooy and other FlightGear contributors. | [GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html). Repainted the exterior white, grey and jade with Cathay Cargo markings. Gear-up exterior. |
| 747-400erf-visual-proxy.glb | Same FlightGear 747-8F source and authors. | GPL v2. Shortened and narrowed the 747-8F mesh and added approximate upright winglets and Cathay Cargo markings. The engine nacelles and other details retain 747-8F geometry. Gear-up exterior. |

GPL permits redistribution and commercial use under its terms. Keep the license and editable sources with the Boeing exports. The GLBs are static. The fleet ZIP includes the original Cathay A330 for local use.

The brushwing is sourced from [Cathay Pacific’s published artwork](https://www.cathaypacific.com/content/dam/header-footer/cx_brushwing_logo.originalimage.png). The white tail version and custom-set livery lettering are in `source/livery/`. The open mesh licenses apply to the underlying models. Cathay owns the brand marks, and permission for public or competition distribution of the branded assets is unverified.

To rebuild the A350 and Boeing GLBs and render the previews, run this from this directory.

```sh
blender -b -t 8 --factory-startup --python-exit-code 1 -P build.py
```

For a Three.js preview, run `python3 -m http.server 8000` from this directory and visit `http://localhost:8000/viewer.html`. The viewer uses Three.js 0.170.0 via jsDelivr. The A330 selector loads the local-use GLB at `models/a330-300.glb`.
