import Geo from '../../geo';
import boxIntersect from 'box-intersect';
import {Vector} from '../../vector';

export default class Label {

    constructor (text, position, size, lines) {
        Object.assign(this, {
            lines: null,
            angle: null,
            text: "",
            position: [],
            size: [],
            bbox: []
        });

        this.id = Label.id++;
        this.text = text;
        this.size = size;

        if (lines) {
            this.line_index = 0;
            this.segment_index = 0;
            this.lines = lines;
            this.angle = this.angleForSegment(this.currentSegment());
            this.position = this.middleSegment(this.currentSegment());
            this.bbox = this.computeOBBox();
        } else {
            this.position = position;
            this.bbox = this.computeBBox();
        }
    }

    middleSegment(segment) {
        return [
            (segment[0][0] + segment[1][0]) / 2,
            (segment[0][1] + segment[1][1]) / 2,
        ];
    }

    occluded (bboxes) {
        // bboxes.push(this.bbox);

        let intersect = false;

        // let res = boxIntersect(bboxes, (i, j) => {
        //     if (bboxes[i] === this.bbox || bboxes[j] === this.bbox) {
        //         let index = bboxes.indexOf(this.bbox);

        //         if (index > -1) {
        //             // remove that bbox
        //             bboxes.splice(index, 1);
        //         }

        //         return true; // early exit
        //     }
        // });

        // let res;

        if (bboxes.length > 0) {
            boxIntersect([this.bbox], bboxes, (i, j) => {
                console.log(`label ${this.text} (${this.id}) intersects ${Label.bbox_labels[j].text} (${Label.bbox_labels[j].id}) (${i}, ${j})`);
                intersect = true;
                return true;
            });
        }

        if (!intersect) {
            console.log(`label ${this.text} (${this.id}) added`);
            Label.bbox_labels[bboxes.length] = this;
            bboxes.push(this.bbox);
        }

        return intersect;
        // return false;
    }

    inTileBounds () {
        let min = [ this.bbox[0], this.bbox[1] ];
        let max = [ this.bbox[2], this.bbox[3] ];

        if (!this.pointInTile(min) || !this.pointInTile(max)) {
            return false;
        }

        return true;
    }

    moveNextSegment () {
        if (this.segment_index + 1 >= this.lines[this.line_index].length - 1) {
            return false;
        }

        this.segment_index++;
        let segment = this.currentSegment();

        this.angle = this.angleForSegment(segment);
        this.position = this.middleSegment(segment);
        this.bbox = this.computeOBBox();

        return true;
    }

    angleForSegment (segment) {
        let p0p1 = Vector.sub(segment[0], segment[1]);

        p0p1 = Vector.normalize(p0p1);

        let theta = Math.atan2(p0p1[0], p0p1[1]) + Math.PI / 2;

        if (theta > Math.PI / 2 || theta < -Math.PI / 2) {
            theta += Math.PI;
        }

        return theta;
    }

    pointInTile (point) {
        let tile_pixel_size = Geo.units_per_pixel * Geo.tile_size;

        return point[0] > 0 && point[1] > -tile_pixel_size && point[0] < tile_pixel_size && point[1] < 0;
    }

    fitToSegment (should_fit = true) {
        if (!should_fit) {
            return true;
        }

        let segment = this.currentSegment();
        let p0p1 = Vector.sub(segment[0], segment[1]);
        let length = Vector.length(p0p1);

        return this.mercatorLength() < length;
    }

    mercatorLength () {
        return this.size[0] * Geo.units_per_pixel;
    }

    mercatorHeight () {
        return this.size[1] * Geo.units_per_pixel;
    }

    currentSegment () {
        let line = this.lines[this.line_index];
        return [ line[this.segment_index], line[this.segment_index + 1] ];
    }

    discard (move_in_tile, keep_in_tile, bboxes) {
        // first main rule : discard line labels that doesn't fit in the line they are sticking to
        if (this.lines && !this.fitToSegment()) {
            while (!this.fitToSegment()) {
                if (!this.moveNextSegment()) {
                    console.log(`warning label ${this.text}: could not fit in any line segment`);
                    break;
                    // console.log(`discarding label ${this.text}: could not fit in any line segment`);
                    // return true;
                }
            }
        }

        let discard = false;

        // perform specific styling rule, should we keep the label in tile bounds?
        if (keep_in_tile) {
            let in_tile = this.inTileBounds();

            if (!in_tile && this.lines && move_in_tile) {
                let fits_to_segment = this.fitToSegment();

                // move this label until we found a line we can fit in
                while (!in_tile && !fits_to_segment) {
                    if (!this.moveNextSegment()) {
                        // we can't move further in this line, just break
                        break;
                    }

                    in_tile = this.inTileBounds();
                    fits_to_segment = this.fitToSegment();
                }

                discard = !in_tile || !fits_to_segment;
                if (discard) {
                    console.log(`discarding label ${this.text}: could not find big enough segment to move into tile bounds`);
                }
            } else if (!in_tile) {
                // we didn't want to move at all, just discard since we're out of tile bounds
                console.log(`discarding label ${this.text}: was not in tile bounds`);
                return true;
            }
        }

        // should we discard? if not, just make occlusion test
        return discard || this.occluded(bboxes);
    }

    computeBBox () {
        let half_merc_width = this.mercatorLength() * 0.5;
        let half_merc_height = this.mercatorHeight() * 0.5;

        return [
            this.position[0] - half_merc_width,
            this.position[1] - half_merc_height,
            this.position[0] + half_merc_width,
            this.position[1] + half_merc_height
        ];
    }

    computeOBBox (size) {
        let upp = Geo.units_per_pixel;

        let half_merc_width = this.size[0] * upp * 0.5;
        let half_merc_height = this.size[1] * upp * 0.5;

        let c = Math.cos(this.angle);
        let s = Math.sin(this.angle);

        let x = half_merc_width * c - half_merc_height * s;
        let y = half_merc_width * s + half_merc_height * c;

        let max = Math.max(x, y);

        return [
            this.position[0] - max,
            this.position[1] - max,
            this.position[0] + max,
            this.position[1] + max
        ];
    }
}

Label.id = 0;
Label.bbox_labels = {}; // map bbox index to label object
