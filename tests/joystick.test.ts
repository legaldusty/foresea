import { describe, expect, it } from 'vitest';
import { bearingFromStick } from '../src/app/drive/Joystick';

describe('drive page joystick', () => {
  it('turns a push on the stick into a compass bearing with north up', () => {
    expect(bearingFromStick(0, -40)).toBeCloseTo(0);
    expect(bearingFromStick(40, 0)).toBeCloseTo(90);
    expect(bearingFromStick(0, 40)).toBeCloseTo(180);
    expect(bearingFromStick(-40, 0)).toBeCloseTo(270);
    expect(bearingFromStick(30, -30)).toBeCloseTo(45);
  });
});
