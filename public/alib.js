/*
 *  Copyright (C) 2002-2015  The DOSBox Team
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
 */
/*
* 2019 - Typescript Version: Thomas Zeugner
*/
var DBOPL;
(function (DBOPL) {
    class Channel {
        constructor(channels, thisChannel, operators, thisOpIndex) {
            this.old = new Int32Array(2);
            this.channels = channels;
            this.ChannelIndex = thisChannel;
            this.operators = operators;
            this.thisOpIndex = thisOpIndex;
            this.old[0] = this.old[1] = 0 | 0;
            this.chanData = 0 | 0;
            this.regB0 = 0 | 0;
            this.regC0 = 0 | 0;
            this.maskLeft = -1 | 0;
            this.maskRight = -1 | 0;
            this.feedback = 31 | 0;
            this.fourMask = 0 | 0;
            this.synthMode = DBOPL.SynthMode.sm2FM;
        }
        Channel(index) {
            return this.channels[this.ChannelIndex + index];
        }
        Op(index) {
            return this.operators[this.thisOpIndex + index];
        }
        SetChanData(chip, data /** Bit32u */) {
            let change = this.chanData ^ data;
            this.chanData = data;
            this.Op(0).chanData = data;
            this.Op(1).chanData = data;
            //Since a frequency update triggered this, always update frequency
            this.Op(0).UpdateFrequency();
            this.Op(1).UpdateFrequency();
            if ((change & (0xff << DBOPL.Shifts.SHIFT_KSLBASE)) != 0) {
                this.Op(0).UpdateAttenuation();
                this.Op(1).UpdateAttenuation();
            }
            if ((change & (0xff << DBOPL.Shifts.SHIFT_KEYCODE)) != 0) {
                this.Op(0).UpdateRates(chip);
                this.Op(1).UpdateRates(chip);
            }
        }
        UpdateFrequency(chip, fourOp /** UInt8 */) {
            //Extrace the frequency signed long
            let data = this.chanData & 0xffff;
            let kslBase = DBOPL.GlobalMembers.KslTable[data >>> 6];
            let keyCode = (data & 0x1c00) >>> 9;
            if ((chip.reg08 & 0x40) != 0) {
                keyCode |= (data & 0x100) >>> 8; /* notesel == 1 */
            }
            else {
                keyCode |= (data & 0x200) >>> 9; /* notesel == 0 */
            }
            //Add the keycode and ksl into the highest signed long of chanData
            data |= (keyCode << DBOPL.Shifts.SHIFT_KEYCODE) | (kslBase << DBOPL.Shifts.SHIFT_KSLBASE);
            this.Channel(0).SetChanData(chip, data);
            if ((fourOp & 0x3f) != 0) {
                this.Channel(1).SetChanData(chip, data);
            }
        }
        WriteA0(chip, val /* UInt8 */) {
            let fourOp = (chip.reg104 & chip.opl3Active & this.fourMask);
            //Don't handle writes to silent fourop channels
            if (fourOp > 0x80) {
                return;
            }
            let change = (this.chanData ^ val) & 0xff;
            if (change != 0) {
                this.chanData ^= change;
                this.UpdateFrequency(chip, fourOp);
            }
        }
        WriteB0(chip, val /* UInt8 */) {
            let fourOp = (chip.reg104 & chip.opl3Active & this.fourMask);
            //Don't handle writes to silent fourop channels
            if (fourOp > 0x80) {
                return;
            }
            let change = ((this.chanData ^ (val << 8)) & 0x1f00);
            if (change != 0) {
                this.chanData ^= change;
                this.UpdateFrequency(chip, fourOp);
            }
            //Check for a change in the keyon/off state
            if (((val ^ this.regB0) & 0x20) == 0) {
                return;
            }
            this.regB0 = val;
            if ((val & 0x20) != 0) {
                this.Op(0).KeyOn(0x1);
                this.Op(1).KeyOn(0x1);
                if ((fourOp & 0x3f) != 0) {
                    this.Channel(1).Op(0).KeyOn(1);
                    this.Channel(1).Op(1).KeyOn(1);
                }
            }
            else {
                this.Op(0).KeyOff(0x1);
                this.Op(1).KeyOff(0x1);
                if ((fourOp & 0x3f) != 0) {
                    this.Channel(1).Op(0).KeyOff(1);
                    this.Channel(1).Op(1).KeyOff(1);
                }
            }
        }
        WriteC0(chip, val /* UInt8 */) {
            let change = (val ^ this.regC0);
            if (change == 0) {
                return;
            }
            this.regC0 = val;
            this.feedback = ((val >>> 1) & 7);
            if (this.feedback != 0) {
                //We shift the input to the right 10 bit wave index value
                this.feedback = (9 - this.feedback) & 0xFF;
            }
            else {
                this.feedback = 31;
            }
            //Select the new synth mode
            if (chip.opl3Active) {
                //4-op mode enabled for this channel
                if (((chip.reg104 & this.fourMask) & 0x3f) != 0) {
                    let chan0;
                    let chan1;
                    //Check if it's the 2nd channel in a 4-op
                    if ((this.fourMask & 0x80) == 0) {
                        chan0 = this.Channel(0);
                        chan1 = this.Channel(1);
                    }
                    else {
                        chan0 = this.Channel(-1);
                        chan1 = this.Channel(0);
                    }
                    let synth = (((chan0.regC0 & 1) << 0) | ((chan1.regC0 & 1) << 1));
                    switch (synth) {
                        case 0:
                            //chan0.synthHandler = this.BlockTemplate<SynthMode.sm3FMFM>;
                            chan0.synthMode = DBOPL.SynthMode.sm3FMFM;
                            break;
                        case 1:
                            //chan0.synthHandler = this.BlockTemplate<SynthMode.sm3AMFM>;
                            chan0.synthMode = DBOPL.SynthMode.sm3AMFM;
                            break;
                        case 2:
                            //chan0.synthHandler = this.BlockTemplate<SynthMode.sm3FMAM>;
                            chan0.synthMode = DBOPL.SynthMode.sm3FMAM;
                            break;
                        case 3:
                            //chan0.synthHandler = this.BlockTemplate<SynthMode.sm3AMAM>;
                            chan0.synthMode = DBOPL.SynthMode.sm3AMAM;
                            break;
                    }
                    //Disable updating percussion channels
                }
                else if ((this.fourMask & 0x40) && (chip.regBD & 0x20)) {
                    //Regular dual op, am or fm
                }
                else if (val & 1) {
                    //this.synthHandler = this.BlockTemplate<SynthMode.sm3AM>;
                    this.synthMode = DBOPL.SynthMode.sm3AM;
                }
                else {
                    //this.synthHandler = this.BlockTemplate<SynthMode.sm3FM>;
                    this.synthMode = DBOPL.SynthMode.sm3FM;
                }
                this.maskLeft = (val & 0x10) != 0 ? -1 : 0;
                this.maskRight = (val & 0x20) != 0 ? -1 : 0;
                //opl2 active
            }
            else {
                //Disable updating percussion channels
                if ((this.fourMask & 0x40) != 0 && (chip.regBD & 0x20) != 0) {
                    //Regular dual op, am or fm
                }
                else if (val & 1) {
                    //this.synthHandler = this.BlockTemplate<SynthMode.sm2AM>;
                    this.synthMode = DBOPL.SynthMode.sm2AM;
                }
                else {
                    //this.synthHandler = this.BlockTemplate<SynthMode.sm2FM>;
                    this.synthMode = DBOPL.SynthMode.sm2FM;
                }
            }
        }
        ResetC0(chip) {
            let val = this.regC0;
            this.regC0 ^= 0xff;
            this.WriteC0(chip, val);
        }
        // template< bool opl3Mode> void Channel::GeneratePercussion( Chip* chip, Bit32s* output ) {
        GeneratePercussion(opl3Mode, chip, output /* Bit32s */, outputOffset) {
            let chan = this;
            //BassDrum
            let mod = ((this.old[0] + this.old[1])) >>> this.feedback;
            this.old[0] = this.old[1];
            this.old[1] = this.Op(0).GetSample(mod);
            //When bassdrum is in AM mode first operator is ignoed
            if ((chan.regC0 & 1) != 0) {
                mod = 0;
            }
            else {
                mod = this.old[0];
            }
            let sample = this.Op(1).GetSample(mod);
            //Precalculate stuff used by other outputs
            let noiseBit = chip.ForwardNoise() & 0x1;
            let c2 = this.Op(2).ForwardWave();
            let c5 = this.Op(5).ForwardWave();
            let phaseBit = (((c2 & 0x88) ^ ((c2 << 5) & 0x80)) | ((c5 ^ (c5 << 2)) & 0x20)) != 0 ? 0x02 : 0x00;
            //Hi-Hat
            let hhVol = this.Op(2).ForwardVolume();
            if (!((hhVol) >= ((12 * 256) >> (3 - ((9) - 9))))) {
                let hhIndex = (phaseBit << 8) | (0x34 << (phaseBit ^ (noiseBit << 1)));
                sample += this.Op(2).GetWave(hhIndex, hhVol);
            }
            //Snare Drum
            let sdVol = this.Op(3).ForwardVolume();
            if (!((sdVol) >= ((12 * 256) >> (3 - ((9) - 9))))) {
                let sdIndex = (0x100 + (c2 & 0x100)) ^ (noiseBit << 8);
                sample += this.Op(3).GetWave(sdIndex, sdVol);
            }
            //Tom-tom
            sample += this.Op(4).GetSample(0);
            //Top-Cymbal
            let tcVol = this.Op(5).ForwardVolume();
            if (!((tcVol) >= ((12 * 256) >> (3 - ((9) - 9))))) {
                let tcIndex = (1 + phaseBit) << 8;
                sample += this.Op(5).GetWave(tcIndex, tcVol);
            }
            sample <<= 1;
            if (opl3Mode) {
                output[outputOffset + 0] += sample;
                output[outputOffset + 1] += sample;
            }
            else {
                output[outputOffset + 0] += sample;
            }
        }
        /// template<SynthMode mode> Channel* Channel::BlockTemplate( Chip* chip, Bit32u samples, Bit32s* output ) 
        //public BlockTemplate(mode: SynthMode, chip: Chip, samples: number, output: Int32Array /** Bit32s* */): Channel {
        synthHandler(chip, samples, output, outputIndex /** Bit32s* */) {
            var mode = this.synthMode;
            switch (mode) {
                case DBOPL.SynthMode.sm2AM:
                case DBOPL.SynthMode.sm3AM:
                    if (this.Op(0).Silent() && this.Op(1).Silent()) {
                        this.old[0] = this.old[1] = 0;
                        return this.Channel(1);
                    }
                    break;
                case DBOPL.SynthMode.sm2FM:
                case DBOPL.SynthMode.sm3FM:
                    if (this.Op(1).Silent()) {
                        this.old[0] = this.old[1] = 0;
                        return this.Channel(1);
                    }
                    break;
                case DBOPL.SynthMode.sm3FMFM:
                    if (this.Op(3).Silent()) {
                        this.old[0] = this.old[1] = 0;
                        return this.Channel(2);
                    }
                    break;
                case DBOPL.SynthMode.sm3AMFM:
                    if (this.Op(0).Silent() && this.Op(3).Silent()) {
                        this.old[0] = this.old[1] = 0;
                        return this.Channel(2);
                    }
                    break;
                case DBOPL.SynthMode.sm3FMAM:
                    if (this.Op(1).Silent() && this.Op(3).Silent()) {
                        this.old[0] = this.old[1] = 0;
                        return this.Channel(2);
                    }
                    break;
                case DBOPL.SynthMode.sm3AMAM:
                    if (this.Op(0).Silent() && this.Op(2).Silent() && this.Op(3).Silent()) {
                        this.old[0] = this.old[1] = 0;
                        return this.Channel(2);
                    }
                    break;
            }
            //Init the operators with the the current vibrato and tremolo values
            this.Op(0).Prepare(chip);
            this.Op(1).Prepare(chip);
            if (mode > DBOPL.SynthMode.sm4Start) {
                this.Op(2).Prepare(chip);
                this.Op(3).Prepare(chip);
            }
            if (mode > DBOPL.SynthMode.sm6Start) {
                this.Op(4).Prepare(chip);
                this.Op(5).Prepare(chip);
            }
            for (let i = 0; i < samples; i++) {
                //Early out for percussion handlers
                if (mode == DBOPL.SynthMode.sm2Percussion) {
                    this.GeneratePercussion(false, chip, output, outputIndex + i);
                    continue; //Prevent some unitialized value bitching
                }
                else if (mode == DBOPL.SynthMode.sm3Percussion) {
                    this.GeneratePercussion(true, chip, output, outputIndex + i * 2);
                    continue; //Prevent some unitialized value bitching
                }
                //Do unsigned shift so we can shift out all signed long but still stay in 10 bit range otherwise
                let mod = ((this.old[0] + this.old[1])) >>> this.feedback;
                this.old[0] = this.old[1];
                this.old[1] = this.Op(0).GetSample(mod);
                let sample;
                let out0 = this.old[0];
                if (mode == DBOPL.SynthMode.sm2AM || mode == DBOPL.SynthMode.sm3AM) {
                    sample = out0 + this.Op(1).GetSample(0);
                }
                else if (mode == DBOPL.SynthMode.sm2FM || mode == DBOPL.SynthMode.sm3FM) {
                    sample = this.Op(1).GetSample(out0);
                }
                else if (mode == DBOPL.SynthMode.sm3FMFM) {
                    let next = this.Op(1).GetSample(out0);
                    next = this.Op(2).GetSample(next);
                    sample = this.Op(3).GetSample(next);
                }
                else if (mode == DBOPL.SynthMode.sm3AMFM) {
                    sample = out0;
                    let next = this.Op(1).GetSample(0);
                    next = this.Op(2).GetSample(next);
                    sample += this.Op(3).GetSample(next);
                }
                else if (mode == DBOPL.SynthMode.sm3FMAM) {
                    sample = this.Op(1).GetSample(out0);
                    let next = this.Op(2).GetSample(0);
                    sample += this.Op(3).GetSample(next);
                }
                else if (mode == DBOPL.SynthMode.sm3AMAM) {
                    sample = out0;
                    let next = this.Op(1).GetSample(0);
                    sample += this.Op(2).GetSample(next);
                    sample += this.Op(3).GetSample(0);
                }
                switch (mode) {
                    case DBOPL.SynthMode.sm2AM:
                    case DBOPL.SynthMode.sm2FM:
                        output[outputIndex + i] += sample;
                        break;
                    case DBOPL.SynthMode.sm3AM:
                    case DBOPL.SynthMode.sm3FM:
                    case DBOPL.SynthMode.sm3FMFM:
                    case DBOPL.SynthMode.sm3AMFM:
                    case DBOPL.SynthMode.sm3FMAM:
                    case DBOPL.SynthMode.sm3AMAM:
                        output[outputIndex + i * 2 + 0] += sample & this.maskLeft;
                        output[outputIndex + i * 2 + 1] += sample & this.maskRight;
                        break;
                }
            }
            switch (mode) {
                case DBOPL.SynthMode.sm2AM:
                case DBOPL.SynthMode.sm2FM:
                case DBOPL.SynthMode.sm3AM:
                case DBOPL.SynthMode.sm3FM:
                    return this.Channel(1);
                case DBOPL.SynthMode.sm3FMFM:
                case DBOPL.SynthMode.sm3AMFM:
                case DBOPL.SynthMode.sm3FMAM:
                case DBOPL.SynthMode.sm3AMAM:
                    return this.Channel(2);
                case DBOPL.SynthMode.sm2Percussion:
                case DBOPL.SynthMode.sm3Percussion:
                    return this.Channel(3);
            }
            return null;
        }
    }
    DBOPL.Channel = Channel;
})(DBOPL || (DBOPL = {}));
/*
 *  Copyright (C) 2002-2015  The DOSBox Team
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
 */
/*
* 2019 - Typescript Version: Thomas Zeugner
*/
var DBOPL;
(function (DBOPL) {
    class Chip {
        constructor() {
            /// Frequency scales for the different multiplications
            this.freqMul = new Uint32Array(16);
            /// Rates for decay and release for rate of this chip
            this.linearRates = new Int32Array(76);
            /// Best match attack rates for the rate of this chip
            this.attackRates = new Int32Array(76);
            this.reg08 = 0;
            this.reg04 = 0;
            this.regBD = 0;
            this.reg104 = 0;
            this.opl3Active = 0;
            const ChannelCount = 18;
            this.chan = new Array(ChannelCount);
            this.op = new Array(2 * ChannelCount);
            for (let i = 0; i < this.op.length; i++) {
                this.op[i] = new DBOPL.Operator();
            }
            for (let i = 0; i < ChannelCount; i++) {
                this.chan[i] = new DBOPL.Channel(this.chan, i, this.op, i * 2);
            }
        }
        ForwardLFO(samples /* UInt32 */) {
            //Current vibrato value, runs 4x slower than tremolo
            this.vibratoSign = (DBOPL.GlobalMembers.VibratoTable[this.vibratoIndex >>> 2]) >> 7;
            this.vibratoShift = ((DBOPL.GlobalMembers.VibratoTable[this.vibratoIndex >>> 2] & 7) + this.vibratoStrength) | 0;
            this.tremoloValue = (DBOPL.GlobalMembers.TremoloTable[this.tremoloIndex] >>> this.tremoloStrength) | 0;
            //Check hom many samples there can be done before the value changes
            let todo = ((256 << (((32 - 10) - 10))) - this.lfoCounter) | 0;
            let count = ((todo + this.lfoAdd - 1) / this.lfoAdd) | 0;
            if (count > samples) {
                count = samples;
                this.lfoCounter += count * this.lfoAdd | 0;
            }
            else {
                this.lfoCounter += count * this.lfoAdd | 0;
                this.lfoCounter &= ((256 << (((32 - 10) - 10))) - 1);
                //Maximum of 7 vibrato value * 4
                this.vibratoIndex = (this.vibratoIndex + 1) & 31;
                //Clip tremolo to the the table size
                if (this.tremoloIndex + 1 < DBOPL.GlobalMembers.TREMOLO_TABLE) {
                    ++this.tremoloIndex;
                }
                else {
                    this.tremoloIndex = 0;
                }
            }
            return count;
        }
        ForwardNoise() {
            this.noiseCounter += this.noiseAdd;
            let count = (this.noiseCounter >>> ((32 - 10) - 10));
            this.noiseCounter &= ((1 << (32 - 10)) - 1);
            for (; count > 0; --count) {
                //Noise calculation from mame
                this.noiseValue ^= (0x800302) & (0 - (this.noiseValue & 1));
                this.noiseValue >>>= 1;
            }
            return this.noiseValue;
        }
        WriteBD(val /* UInt8 */) {
            let change = this.regBD ^ val;
            if (change == 0) {
                return;
            }
            this.regBD = val | 0;
            /// TODO could do this with shift and xor?
            this.vibratoStrength = ((val & 0x40) != 0 ? 0x00 : 0x01);
            this.tremoloStrength = ((val & 0x80) != 0 ? 0x00 : 0x02);
            if ((val & 0x20) != 0) {
                //Drum was just enabled, make sure channel 6 has the right synth
                if ((change & 0x20) != 0) {
                    if (this.opl3Active) {
                        //this.chan[6].synthHandler = & Channel.BlockTemplate < SynthMode.sm3Percussion >;
                        this.chan[6].synthMode = DBOPL.SynthMode.sm3Percussion;
                    }
                    else {
                        //this.chan[6].synthHandler = & Channel.BlockTemplate < SynthMode.sm2Percussion >;
                        this.chan[6].synthMode = DBOPL.SynthMode.sm2Percussion;
                    }
                }
                //Bass Drum
                if ((val & 0x10) != 0) {
                    this.chan[6].Op(0).KeyOn(0x2);
                    this.chan[6].Op(1).KeyOn(0x2);
                }
                else {
                    this.chan[6].Op(0).KeyOff(0x2);
                    this.chan[6].Op(1).KeyOff(0x2);
                }
                //Hi-Hat
                if ((val & 0x1) != 0) {
                    this.chan[7].Op(0).KeyOn(0x2);
                }
                else {
                    this.chan[7].Op(0).KeyOff(0x2);
                }
                //Snare
                if ((val & 0x8) != 0) {
                    this.chan[7].Op(1).KeyOn(0x2);
                }
                else {
                    this.chan[7].Op(1).KeyOff(0x2);
                }
                //Tom-Tom
                if ((val & 0x4) != 0) {
                    this.chan[8].Op(0).KeyOn(0x2);
                }
                else {
                    this.chan[8].Op(0).KeyOff(0x2);
                }
                //Top Cymbal
                if ((val & 0x2) != 0) {
                    this.chan[8].Op(1).KeyOn(0x2);
                }
                else {
                    this.chan[8].Op(1).KeyOff(0x2);
                }
            }
            else if (change & 0x20) {
                //Trigger a reset to setup the original synth handler
                this.chan[6].ResetC0(this);
                this.chan[6].Op(0).KeyOff(0x2);
                this.chan[6].Op(1).KeyOff(0x2);
                this.chan[7].Op(0).KeyOff(0x2);
                this.chan[7].Op(1).KeyOff(0x2);
                this.chan[8].Op(0).KeyOff(0x2);
                this.chan[8].Op(1).KeyOff(0x2);
            }
        }
        WriteReg(reg /* int */, val /** byte */) {
            let index = 0;
            switch ((reg & 0xf0) >>> 4) {
                case 0x00 >> 4:
                    if (reg == 0x01) {
                        this.waveFormMask = ((val & 0x20) != 0 ? 0x7 : 0x0);
                    }
                    else if (reg == 0x104) {
                        if (((this.reg104 ^ val) & 0x3f) == 0) {
                            return;
                        }
                        this.reg104 = (0x80 | (val & 0x3f));
                    }
                    else if (reg == 0x105) {
                        if (((this.opl3Active ^ val) & 1) == 0) {
                            return;
                        }
                        this.opl3Active = (val & 1) != 0 ? 0xff : 0;
                        for (let i = 0; i < 18; i++) {
                            this.chan[i].ResetC0(this);
                        }
                    }
                    else if (reg == 0x08) {
                        this.reg08 = val;
                    }
                case 0x10 >> 4:
                    break;
                case 0x20 >> 4:
                case 0x30 >> 4:
                    index = (((reg >>> 3) & 0x20) | (reg & 0x1f));
                    if (this.OpTable[index]) {
                        this.OpTable[index].Write20(this, val);
                    }
                    ;
                    break;
                case 0x40 >> 4:
                case 0x50 >> 4:
                    index = (((reg >>> 3) & 0x20) | (reg & 0x1f));
                    if (this.OpTable[index]) {
                        this.OpTable[index].Write40(this, val);
                    }
                    ;
                    break;
                case 0x60 >> 4:
                case 0x70 >> 4:
                    index = (((reg >>> 3) & 0x20) | (reg & 0x1f));
                    if (this.OpTable[index]) {
                        this.OpTable[index].Write60(this, val);
                    }
                    ;
                    break;
                case 0x80 >> 4:
                case 0x90 >> 4:
                    index = (((reg >>> 3) & 0x20) | (reg & 0x1f));
                    if (this.OpTable[index]) {
                        this.OpTable[index].Write80(this, val);
                    }
                    ;
                    break;
                case 0xa0 >> 4:
                    index = (((reg >>> 4) & 0x10) | (reg & 0xf));
                    if (this.ChanTable[index]) {
                        this.ChanTable[index].WriteA0(this, val);
                    }
                    ;
                    break;
                case 0xb0 >> 4:
                    if (reg == 0xbd) {
                        this.WriteBD(val);
                    }
                    else {
                        index = (((reg >>> 4) & 0x10) | (reg & 0xf));
                        if (this.ChanTable[index]) {
                            this.ChanTable[index].WriteB0(this, val);
                        }
                        ;
                    }
                    break;
                case 0xc0 >> 4:
                    index = (((reg >>> 4) & 0x10) | (reg & 0xf));
                    if (this.ChanTable[index]) {
                        this.ChanTable[index].WriteC0(this, val);
                    }
                    ;
                case 0xd0 >> 4:
                    break;
                case 0xe0 >> 4:
                case 0xf0 >> 4:
                    index = (((reg >>> 3) & 0x20) | (reg & 0x1f));
                    if (this.OpTable[index]) {
                        this.OpTable[index].WriteE0(this, val);
                    }
                    ;
                    break;
            }
        }
        WriteAddr(port /* UInt32 */, val /* byte */) {
            switch (port & 3) {
                case 0:
                    return val;
                case 2:
                    if (this.opl3Active || (val == 0x05)) {
                        return 0x100 | val;
                    }
                    else {
                        return val;
                    }
            }
            return 0;
        }
        GenerateBlock2(total /* UInt32 */, output /*  Int32 */) {
            let outputIndex = 0;
            while (total > 0) {
                let samples = this.ForwardLFO(total);
                //todo ?? do we need this
                //output.fill(0, outputIndex, outputIndex + samples);
                let ch = this.chan[0];
                while (ch.ChannelIndex < 9) {
                    //ch.printDebug();
                    ch = ch.synthHandler(this, samples, output, outputIndex);
                }
                total -= samples;
                outputIndex += samples;
            }
        }
        GenerateBlock3(total /* UInt32 */, output /* Int32 */) {
            let outputIndex = 0;
            while (total > 0) {
                let samples = this.ForwardLFO(total);
                output.fill(0, outputIndex, outputIndex + samples * 2);
                //int count = 0;
                for (let c = 0; c < 18; c++) {
                    //count++;
                    this.chan[c].synthHandler(this, samples, output, outputIndex);
                }
                total -= samples;
                outputIndex += samples * 2;
            }
        }
        Setup(rate /* UInt32 */) {
            this.InitTables();
            let scale = DBOPL.GlobalMembers.OPLRATE / rate;
            //Noise counter is run at the same precision as general waves
            this.noiseAdd = (0.5 + scale * (1 << ((32 - 10) - 10))) | 0;
            this.noiseCounter = 0 | 0;
            this.noiseValue = 1 | 0; //Make sure it triggers the noise xor the first time
            //The low frequency oscillation counter
            //Every time his overflows vibrato and tremoloindex are increased
            this.lfoAdd = (0.5 + scale * (1 << ((32 - 10) - 10))) | 0;
            this.lfoCounter = 0 | 0;
            this.vibratoIndex = 0 | 0;
            this.tremoloIndex = 0 | 0;
            //With higher octave this gets shifted up
            //-1 since the freqCreateTable = *2
            let freqScale = (0.5 + scale * (1 << ((32 - 10) - 1 - 10))) | 0;
            for (let i = 0; i < 16; i++) {
                this.freqMul[i] = (freqScale * DBOPL.GlobalMembers.FreqCreateTable[i]) | 0;
            }
            //-3 since the real envelope takes 8 steps to reach the single value we supply
            for (let i = 0; i < 76; i++) {
                let index = DBOPL.GlobalMembers.EnvelopeSelectIndex(i);
                let shift = DBOPL.GlobalMembers.EnvelopeSelectShift(i);
                this.linearRates[i] = (scale * (DBOPL.GlobalMembers.EnvelopeIncreaseTable[index] << (24 + ((9) - 9) - shift - 3))) | 0;
            }
            //Generate the best matching attack rate
            for (let i = 0; i < 62; i++) {
                let index = DBOPL.GlobalMembers.EnvelopeSelectIndex(i);
                let shift = DBOPL.GlobalMembers.EnvelopeSelectShift(i);
                //Original amount of samples the attack would take
                let original = ((DBOPL.GlobalMembers.AttackSamplesTable[index] << shift) / scale) | 0;
                let guessAdd = (scale * (DBOPL.GlobalMembers.EnvelopeIncreaseTable[index] << (24 - shift - 3))) | 0;
                let bestAdd = guessAdd;
                let bestDiff = 1 << 30;
                for (let passes = 0; passes < 16; passes++) {
                    let volume = (511 << ((9) - 9));
                    let samples = 0;
                    let count = 0;
                    while (volume > 0 && samples < original * 2) {
                        count += guessAdd;
                        let change = count >>> 24;
                        count &= ((1 << 24) - 1);
                        if ((change) != 0) {
                            volume += (~volume * change) >> 3;
                        }
                        samples++;
                    }
                    let diff = original - samples;
                    let lDiff = Math.abs(diff) | 0;
                    //Init last on first pass
                    if (lDiff < bestDiff) {
                        bestDiff = lDiff;
                        bestAdd = guessAdd;
                        if (bestDiff == 0) {
                            break;
                        }
                    }
                    //Below our target
                    if (diff < 0) {
                        //Better than the last time
                        let mul = (((original - diff) << 12) / original) | 0;
                        guessAdd = ((guessAdd * mul) >> 12);
                        guessAdd++;
                    }
                    else if (diff > 0) {
                        let mul = (((original - diff) << 12) / original) | 0;
                        guessAdd = (guessAdd * mul) >> 12;
                        guessAdd--;
                    }
                }
                this.attackRates[i] = bestAdd;
            }
            for (let i = 62; i < 76; i++) {
                //This should provide instant volume maximizing
                this.attackRates[i] = 8 << 24;
            }
            //Setup the channels with the correct four op flags
            //Channels are accessed through a table so they appear linear here
            this.chan[0].fourMask = (0x00 | (1 << 0));
            this.chan[1].fourMask = (0x80 | (1 << 0));
            this.chan[2].fourMask = (0x00 | (1 << 1));
            this.chan[3].fourMask = (0x80 | (1 << 1));
            this.chan[4].fourMask = (0x00 | (1 << 2));
            this.chan[5].fourMask = (0x80 | (1 << 2));
            this.chan[9].fourMask = (0x00 | (1 << 3));
            this.chan[10].fourMask = (0x80 | (1 << 3));
            this.chan[11].fourMask = (0x00 | (1 << 4));
            this.chan[12].fourMask = (0x80 | (1 << 4));
            this.chan[13].fourMask = (0x00 | (1 << 5));
            this.chan[14].fourMask = (0x80 | (1 << 5));
            //mark the percussion channels
            this.chan[6].fourMask = 0x40;
            this.chan[7].fourMask = 0x40;
            this.chan[8].fourMask = 0x40;
            //Clear Everything in opl3 mode
            this.WriteReg(0x105, 0x1);
            for (let i = 0; i < 512; i++) {
                if (i == 0x105) {
                    continue;
                }
                this.WriteReg(i, 0xff);
                this.WriteReg(i, 0x0);
            }
            this.WriteReg(0x105, 0x0);
            //Clear everything in opl2 mode
            for (let i = 0; i < 255; i++) {
                this.WriteReg(i, 0xff);
                this.WriteReg(i, 0x0);
            }
        }
        InitTables() {
            this.OpTable = new Array(DBOPL.GlobalMembers.OpOffsetTable.length);
            for (let i = 0; i < DBOPL.GlobalMembers.OpOffsetTable.length; i++) {
                this.OpTable[i] = this.op[DBOPL.GlobalMembers.OpOffsetTable[i]];
            }
            this.ChanTable = new Array(DBOPL.GlobalMembers.ChanOffsetTable.length);
            for (let i = 0; i < DBOPL.GlobalMembers.ChanOffsetTable.length; i++) {
                this.ChanTable[i] = this.chan[DBOPL.GlobalMembers.ChanOffsetTable[i]];
            }
        }
    }
    DBOPL.Chip = Chip;
})(DBOPL || (DBOPL = {}));
/*
 *  Copyright (C) 2002-2015  The DOSBox Team
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
 */
/*
* 2019 - Typescript Version: Thomas Zeugner
*/
var DBOPL;
(function (DBOPL) {
    class GlobalMembers {
        static EnvelopeSelectShift(val /* UInt8  */) {
            if (val < 13 * 4) {
                return 12 - (val >>> 2);
            }
            else if (val < 15 * 4) {
                return 0;
            }
            else {
                return 0;
            }
        }
        static EnvelopeSelectIndex(val /* UInt8  */) {
            if (val < 13 * 4) {
                return (val & 3);
            }
            else if (val < 15 * 4) {
                return val - 12 * 4;
            }
            else {
                return 12;
            }
        }
        static InitTables() {
            if (GlobalMembers.doneTables) {
                return;
            }
            GlobalMembers.doneTables = true;
            /// Multiplication based tables
            for (let i = 0; i < 384; i++) {
                let s = i * 8;
                /// TODO maybe keep some of the precision errors of the original table?
                let val = (0.5 + (Math.pow(2.0, -1.0 + (255 - s) * (1.0 / 256))) * (1 << 16)) | 0;
                GlobalMembers.MulTable[i] = val;
            }
            //Sine Wave Base
            for (let i = 0; i < 512; i++) {
                GlobalMembers.WaveTable[0x0200 + i] = (Math.sin((i + 0.5) * (3.14159265358979323846 / 512.0)) * 4084) | 0;
                GlobalMembers.WaveTable[0x0000 + i] = -GlobalMembers.WaveTable[0x200 + i];
            }
            //Exponential wave
            for (let i = 0; i < 256; i++) {
                GlobalMembers.WaveTable[0x700 + i] = (0.5 + (Math.pow(2.0, -1.0 + (255 - i * 8) * (1.0 / 256))) * 4085) | 0;
                GlobalMembers.WaveTable[0x6ff - i] = -GlobalMembers.WaveTable[0x700 + i];
            }
            for (let i = 0; i < 256; i++) {
                /// Fill silence gaps
                GlobalMembers.WaveTable[0x400 + i] = GlobalMembers.WaveTable[0];
                GlobalMembers.WaveTable[0x500 + i] = GlobalMembers.WaveTable[0];
                GlobalMembers.WaveTable[0x900 + i] = GlobalMembers.WaveTable[0];
                GlobalMembers.WaveTable[0xc00 + i] = GlobalMembers.WaveTable[0];
                GlobalMembers.WaveTable[0xd00 + i] = GlobalMembers.WaveTable[0];
                /// Replicate sines in other pieces
                GlobalMembers.WaveTable[0x800 + i] = GlobalMembers.WaveTable[0x200 + i];
                /// double speed sines
                GlobalMembers.WaveTable[0xa00 + i] = GlobalMembers.WaveTable[0x200 + i * 2];
                GlobalMembers.WaveTable[0xb00 + i] = GlobalMembers.WaveTable[0x000 + i * 2];
                GlobalMembers.WaveTable[0xe00 + i] = GlobalMembers.WaveTable[0x200 + i * 2];
                GlobalMembers.WaveTable[0xf00 + i] = GlobalMembers.WaveTable[0x200 + i * 2];
            }
            /// Create the ksl table
            for (let oct = 0; oct < 8; oct++) {
                let base = (oct * 8) | 0;
                for (let i = 0; i < 16; i++) {
                    let val = base - GlobalMembers.KslCreateTable[i];
                    if (val < 0) {
                        val = 0;
                    }
                    /// *4 for the final range to match attenuation range
                    GlobalMembers.KslTable[oct * 16 + i] = (val * 4) | 0;
                }
            }
            /// Create the Tremolo table, just increase and decrease a triangle wave
            for (let i = 0; i < 52 / 2; i++) {
                let val = (i << ((9) - 9)) | 0;
                GlobalMembers.TremoloTable[i] = val;
                GlobalMembers.TremoloTable[52 - 1 - i] = val;
            }
            /// Create a table with offsets of the channels from the start of the chip
            for (let i = 0; i < 32; i++) {
                let index = (i & 0xf);
                if (index >= 9) {
                    GlobalMembers.ChanOffsetTable[i] = -1;
                    continue;
                }
                /// Make sure the four op channels follow eachother
                if (index < 6) {
                    index = ((index % 3) * 2 + ((index / 3) | 0)) | 0;
                }
                /// Add back the bits for highest ones
                if (i >= 16) {
                    index += 9;
                }
                GlobalMembers.ChanOffsetTable[i] = index;
            }
            /// Same for operators
            for (let i = 0; i < 64; i++) {
                if (i % 8 >= 6 || (((i / 8) | 0) % 4 == 3)) {
                    GlobalMembers.OpOffsetTable[i] = null;
                    continue;
                }
                let chNum = (((i / 8) | 0) * 3 + (i % 8) % 3) | 0;
                //Make sure we use 16 and up for the 2nd range to match the chanoffset gap
                if (chNum >= 12) {
                    chNum += 16 - 12;
                }
                let opNum = ((i % 8) / 3) | 0;
                if (GlobalMembers.ChanOffsetTable[chNum] == -1) {
                    GlobalMembers.OpOffsetTable[i] = -1;
                }
                else {
                    let c = GlobalMembers.ChanOffsetTable[chNum];
                    GlobalMembers.OpOffsetTable[i] = c * 2 + opNum;
                }
            }
        }
    }
    GlobalMembers.OPLRATE = (14318180.0 / 288.0); // double
    /// How much to substract from the base value for the final attenuation
    GlobalMembers.KslCreateTable = new Uint8Array([
        64, 32, 24, 19,
        16, 12, 11, 10,
        8, 6, 5, 4,
        3, 2, 1, 0
    ]); /* UInt8[]*/
    GlobalMembers.FreqCreateTable = new Uint8Array([
        (0.5 * 2), (1 * 2), (2 * 2), (3 * 2), (4 * 2), (5 * 2), (6 * 2), (7 * 2),
        (8 * 2), (9 * 2), (10 * 2), (10 * 2), (12 * 2), (12 * 2), (15 * 2), (15 * 2)
    ]); /** final UInt8[]  */
    /// We're not including the highest attack rate, that gets a special value
    GlobalMembers.AttackSamplesTable = new Uint8Array([
        69, 55, 46, 40,
        35, 29, 23, 20,
        19, 15, 11, 10,
        9
    ]); /** UInt8 */
    GlobalMembers.EnvelopeIncreaseTable = new Uint8Array([
        4, 5, 6, 7,
        8, 10, 12, 14,
        16, 20, 24, 28,
        32
    ]); /** UInt8 */
    /// Layout of the waveform table in 512 entry intervals
    /// With overlapping waves we reduce the table to half it's size
    /// 	|    |//\\|____|WAV7|//__|/\  |____|/\/\|
    /// 	|\\//|    |    |WAV7|    |  \/|    |    |
    /// 	|06  |0126|17  |7   |3   |4   |4 5 |5   |
    /// 6 is just 0 shifted and masked
    GlobalMembers.WaveTable = new Int16Array(8 * 512); /** Bit16s */
    GlobalMembers.WaveBaseTable = new Uint16Array([
        0x000, 0x200, 0x200, 0x800,
        0xa00, 0xc00, 0x100, 0x400
    ]); /** UInt16 */
    GlobalMembers.WaveMaskTable = new Uint16Array([
        1023, 1023, 511, 511,
        1023, 1023, 512, 1023
    ]); /** UInt16 */
    /// Where to start the counter on at keyon
    GlobalMembers.WaveStartTable = new Uint16Array([
        512, 0, 0, 0,
        0, 512, 512, 256
    ]); /** UInt16 */
    GlobalMembers.MulTable = new Uint16Array(384); /** UInt16[] */
    GlobalMembers.TREMOLO_TABLE = 52;
    GlobalMembers.KslTable = new Uint8Array(8 * 16); /** UInt8[] */
    GlobalMembers.TremoloTable = new Uint8Array(GlobalMembers.TREMOLO_TABLE); /** UInt8[] */
    //Start of a channel behind the chip struct start
    GlobalMembers.ChanOffsetTable = new Int16Array(32); /** UInt16[] */
    //Start of an operator behind the chip struct start
    GlobalMembers.OpOffsetTable = new Int16Array(64); /** UInt16[] */
    //The lower bits are the shift of the operator vibrato value
    //The highest bit is right shifted to generate -1 or 0 for negation
    //So taking the highest input value of 7 this gives 3, 7, 3, 0, -3, -7, -3, 0
    GlobalMembers.VibratoTable = new Int8Array([
        1 - 0x00, 0 - 0x00, 1 - 0x00, 30 - 0x00,
        1 - 0x80, 0 - 0x80, 1 - 0x80, 30 - 0x80
    ]); /** Int8 */
    //Shift strength for the ksl value determined by ksl strength
    GlobalMembers.KslShiftTable = new Uint8Array([31, 1, 2, 0]); /** UInt8 */
    GlobalMembers.doneTables = false;
    DBOPL.GlobalMembers = GlobalMembers;
})(DBOPL || (DBOPL = {}));
/*
 *  Copyright (C) 2002-2015  The DOSBox Team
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
 */
/*
* 2019 - Typescript Version: Thomas Zeugner
*/
var DBOPL;
(function (DBOPL) {
    class Handler {
        constructor() {
            this.chip = new DBOPL.Chip();
        }
        WriteAddr(port /* int */, val /* byte */) {
            return this.chip.WriteAddr(port, val);
        }
        WriteReg(addr /* int */, val /* byte */) {
            this.chip.WriteReg(addr, val);
        }
        Generate(chan, samples /* short */) {
            let buffer = new Int32Array(512 * 2);
            if ((samples > 512)) {
                samples = 512;
            }
            if (!this.chip.opl3Active) {
                this.chip.GenerateBlock2(samples, buffer);
                chan.AddSamples_m32(samples, buffer);
            }
            else {
                this.chip.GenerateBlock3(samples, buffer);
                chan.AddSamples_s32(samples, buffer);
            }
        }
        Init(rate /* short */) {
            DBOPL.GlobalMembers.InitTables();
            this.chip.Setup(rate);
        }
    }
    DBOPL.Handler = Handler;
})(DBOPL || (DBOPL = {}));
/*
 *  Copyright (C) 2002-2015  The DOSBox Team
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
 */
/*
* 2019 - Typescript Version: Thomas Zeugner
*/
var DBOPL;
(function (DBOPL) {
    class MixerChannel {
        constructor(buffer, channels) {
            this.buffer = buffer;
            this.channels = channels;
        }
        CLIP(v) {
            const SAMPLE_SIZE = 2;
            const SAMP_BITS = (SAMPLE_SIZE << 3);
            const SAMP_MAX = ((1 << (SAMP_BITS - 1)) - 1);
            const SAMP_MIN = -((1 << (SAMP_BITS - 1)));
            return (((v) > SAMP_MAX) ? SAMP_MAX : (((v) < SAMP_MIN) ? SAMP_MIN : (v)));
        }
        AddSamples_m32(samples, buffer) {
            // Volume amplication (0 == none, 1 == 2x, 2 == 4x)
            const VOL_AMP = 1;
            // Convert samples from mono int32 to stereo int16
            let out = this.buffer;
            let outIndex = 0;
            let ch = this.channels;
            if (ch == 2) {
                for (let i = 0; i < samples; i++) {
                    let v = this.CLIP(buffer[i] << VOL_AMP);
                    out[outIndex] = v;
                    outIndex++;
                    out[outIndex] = v;
                    outIndex++;
                }
            }
            else {
                for (let i = 0; i < samples; i++) {
                    let v = buffer[i] << VOL_AMP;
                    out[outIndex] = this.CLIP(v);
                    outIndex++;
                }
            }
            return;
        }
        AddSamples_s32(samples, buffer) {
            // Volume amplication (0 == none, 1 == 2x, 2 == 4x)
            const VOL_AMP = 1;
            // Convert samples from stereo s32 to stereo s16
            let out = this.buffer;
            let outIndex = 0;
            let ch = this.channels;
            if (ch == 2) {
                for (let i = 0; i < samples; i++) {
                    let v = buffer[i * 2] << VOL_AMP;
                    out[outIndex] = this.CLIP(v);
                    outIndex++;
                    v = buffer[i * 2 + 1] << VOL_AMP;
                    out[outIndex] = this.CLIP(v);
                    outIndex++;
                }
            }
            else {
                for (let i = 0; i < samples; i++) {
                    let v = buffer[i * 2] << VOL_AMP;
                    out[outIndex] = this.CLIP(v);
                    outIndex++;
                }
            }
            return;
        }
    }
    DBOPL.MixerChannel = MixerChannel;
})(DBOPL || (DBOPL = {}));
/*
 *  Copyright (C) 2002-2015  The DOSBox Team
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
 */
/*
* 2019 - Typescript Version: Thomas Zeugner
*/
var DBOPL;
(function (DBOPL) {
    var Operator20Masks;
    (function (Operator20Masks) {
        Operator20Masks[Operator20Masks["MASK_KSR"] = 16] = "MASK_KSR";
        Operator20Masks[Operator20Masks["MASK_SUSTAIN"] = 32] = "MASK_SUSTAIN";
        Operator20Masks[Operator20Masks["MASK_VIBRATO"] = 64] = "MASK_VIBRATO";
        Operator20Masks[Operator20Masks["MASK_TREMOLO"] = 128] = "MASK_TREMOLO";
    })(Operator20Masks || (Operator20Masks = {}));
    var State;
    (function (State) {
        State[State["OFF"] = 0] = "OFF";
        State[State["RELEASE"] = 1] = "RELEASE";
        State[State["SUSTAIN"] = 2] = "SUSTAIN";
        State[State["DECAY"] = 3] = "DECAY";
        State[State["ATTACK"] = 4] = "ATTACK";
    })(State || (State = {}));
    class Operator {
        constructor() {
            this.chanData = 0 | 0;
            this.freqMul = 0 | 0;
            this.waveIndex = 0 >>> 0;
            this.waveAdd = 0 | 0;
            this.waveCurrent = 0 | 0;
            this.keyOn = 0 | 0;
            this.ksr = 0 | 0;
            this.reg20 = 0 | 0;
            this.reg40 = 0 | 0;
            this.reg60 = 0 | 0;
            this.reg80 = 0 | 0;
            this.regE0 = 0 | 0;
            this.SetState(State.OFF);
            this.rateZero = (1 << State.OFF);
            this.sustainLevel = (511 << ((9) - 9));
            this.currentLevel = (511 << ((9) - 9));
            this.totalLevel = (511 << ((9) - 9));
            this.volume = (511 << ((9) - 9));
            this.releaseAdd = 0;
        }
        SetState(s /** Int8 */) {
            this.state = s;
        }
        //We zero out when rate == 0
        UpdateAttack(chip) {
            let rate = this.reg60 >>> 4; /** UInt8 */
            if (rate != 0) {
                let val = ((rate << 2) + this.ksr) | 0; /** UInt8 */
                ;
                this.attackAdd = chip.attackRates[val];
                this.rateZero &= ~(1 << State.ATTACK);
            }
            else {
                this.attackAdd = 0;
                this.rateZero |= (1 << State.ATTACK);
            }
        }
        UpdateRelease(chip) {
            let rate = (this.reg80 & 0xf);
            if (rate != 0) {
                let val = ((rate << 2) + this.ksr) | 0;
                this.releaseAdd = chip.linearRates[val];
                this.rateZero &= ~(1 << State.RELEASE);
                if ((this.reg20 & Operator20Masks.MASK_SUSTAIN) == 0) {
                    this.rateZero &= ~(1 << State.SUSTAIN);
                }
            }
            else {
                this.rateZero |= (1 << State.RELEASE);
                this.releaseAdd = 0;
                if ((this.reg20 & Operator20Masks.MASK_SUSTAIN) == 0) {
                    this.rateZero |= (1 << State.SUSTAIN);
                }
            }
        }
        UpdateDecay(chip) {
            let rate = (this.reg60 & 0xf);
            if (rate != 0) {
                let val = ((rate << 2) + this.ksr) | 0;
                this.decayAdd = chip.linearRates[val];
                this.rateZero &= ~(1 << State.DECAY);
            }
            else {
                this.decayAdd = 0;
                this.rateZero |= (1 << State.DECAY);
            }
        }
        UpdateAttenuation() {
            let kslBase = ((this.chanData >>> DBOPL.Shifts.SHIFT_KSLBASE) & 0xff);
            let tl = this.reg40 & 0x3f;
            let kslShift = DBOPL.GlobalMembers.KslShiftTable[this.reg40 >>> 6];
            //Make sure the attenuation goes to the right Int32
            this.totalLevel = tl << ((9) - 7);
            this.totalLevel += (kslBase << ((9) - 9)) >> kslShift;
        }
        UpdateRates(chip) {
            //Mame seems to reverse this where enabling ksr actually lowers
            //the rate, but pdf manuals says otherwise?
            let newKsr = ((this.chanData >>> DBOPL.Shifts.SHIFT_KEYCODE) & 0xff);
            if ((this.reg20 & Operator20Masks.MASK_KSR) == 0) {
                newKsr >>>= 2;
            }
            if (this.ksr == newKsr) {
                return;
            }
            this.ksr = newKsr;
            this.UpdateAttack(chip);
            this.UpdateDecay(chip);
            this.UpdateRelease(chip);
        }
        UpdateFrequency() {
            let freq = this.chanData & ((1 << 10) - 1) | 0;
            let block = (this.chanData >>> 10) & 0xff;
            this.waveAdd = ((freq << block) * this.freqMul) | 0;
            if ((this.reg20 & Operator20Masks.MASK_VIBRATO) != 0) {
                this.vibStrength = (freq >>> 7) & 0xFF;
                this.vibrato = ((this.vibStrength << block) * this.freqMul) | 0;
            }
            else {
                this.vibStrength = 0;
                this.vibrato = 0;
            }
        }
        Write20(chip, val /** Int8 */) {
            let change = (this.reg20 ^ val);
            if (change == 0) {
                return;
            }
            this.reg20 = val;
            //Shift the tremolo bit over the entire register, saved a branch, YES!
            this.tremoloMask = ((val) >> 7) & 0xFF;
            this.tremoloMask &= ~((1 << ((9) - 9)) - 1);
            //Update specific features based on changes
            if ((change & Operator20Masks.MASK_KSR) != 0) {
                this.UpdateRates(chip);
            }
            //With sustain enable the volume doesn't change
            if ((this.reg20 & Operator20Masks.MASK_SUSTAIN) != 0 || (this.releaseAdd == 0)) {
                this.rateZero |= (1 << State.SUSTAIN);
            }
            else {
                this.rateZero &= ~(1 << State.SUSTAIN);
            }
            //Frequency multiplier or vibrato changed
            if ((change & (0xf | Operator20Masks.MASK_VIBRATO)) != 0) {
                this.freqMul = chip.freqMul[val & 0xf];
                this.UpdateFrequency();
            }
        }
        Write40(chip, val /** Int8 */) {
            if ((this.reg40 ^ val) == 0) {
                return;
            }
            this.reg40 = val;
            this.UpdateAttenuation();
        }
        Write60(chip, val /** Int8 */) {
            let change = (this.reg60 ^ val);
            this.reg60 = val;
            if ((change & 0x0f) != 0) {
                this.UpdateDecay(chip);
            }
            if ((change & 0xf0) != 0) {
                this.UpdateAttack(chip);
            }
        }
        Write80(chip, val /** Int8 */) {
            let change = (this.reg80 ^ val);
            if (change == 0) {
                return;
            }
            this.reg80 = val;
            let sustain = (val >>> 4);
            //Turn 0xf into 0x1f
            sustain |= (sustain + 1) & 0x10;
            this.sustainLevel = sustain << ((9) - 5);
            if ((change & 0x0f) != 0) {
                this.UpdateRelease(chip);
            }
        }
        WriteE0(chip, val /** Int8 */) {
            if ((this.regE0 ^ val) == 0) {
                return;
            }
            //in opl3 mode you can always selet 7 waveforms regardless of waveformselect
            let waveForm = (val & ((0x3 & chip.waveFormMask) | (0x7 & chip.opl3Active)));
            this.regE0 = val;
            //this.waveBase = GlobalMembers.WaveTable + GlobalMembers.WaveBaseTable[waveForm];
            this.waveBase = DBOPL.GlobalMembers.WaveBaseTable[waveForm];
            this.waveStart = (DBOPL.GlobalMembers.WaveStartTable[waveForm] << (32 - 10)) >>> 0;
            this.waveMask = DBOPL.GlobalMembers.WaveMaskTable[waveForm];
        }
        Silent() {
            if (!((this.totalLevel + this.volume) >= ((12 * 256) >> (3 - ((9) - 9))))) {
                return false;
            }
            if ((this.rateZero & (1 << this.state)) == 0) {
                return false;
            }
            return true;
        }
        Prepare(chip) {
            this.currentLevel = this.totalLevel + (chip.tremoloValue & this.tremoloMask);
            this.waveCurrent = this.waveAdd;
            if ((this.vibStrength >>> chip.vibratoShift) != 0) {
                let add = this.vibrato >>> chip.vibratoShift;
                //Sign extend over the shift value
                let neg = chip.vibratoSign;
                //Negate the add with -1 or 0
                add = ((add ^ neg) - neg);
                this.waveCurrent += add;
            }
        }
        KeyOn(mask /** Int8 */) {
            if (this.keyOn == 0) {
                //Restart the frequency generator
                this.waveIndex = this.waveStart;
                this.rateIndex = 0;
                this.SetState(State.ATTACK);
            }
            this.keyOn |= mask;
        }
        KeyOff(mask /** Int8 */) {
            this.keyOn &= ~mask;
            if (this.keyOn == 0) {
                if (this.state != State.OFF) {
                    this.SetState(State.RELEASE);
                }
            }
        }
        // public TemplateVolume(yes:State):number {
        TemplateVolume() {
            var yes = this.state;
            let vol = this.volume;
            let change;
            switch (yes) {
                case State.OFF:
                    return (511 << ((9) - 9));
                case State.ATTACK:
                    change = this.RateForward(this.attackAdd);
                    if (change == 0) {
                        return vol;
                    }
                    vol += ((~vol) * change) >> 3;
                    if (vol < 0) {
                        this.volume = 0;
                        this.rateIndex = 0;
                        this.SetState(State.DECAY);
                        return 0;
                    }
                    break;
                case State.DECAY:
                    vol += this.RateForward(this.decayAdd);
                    if ((vol >= this.sustainLevel)) {
                        //Check if we didn't overshoot max attenuation, then just go off
                        if ((vol >= (511 << ((9) - 9)))) {
                            this.volume = (511 << ((9) - 9));
                            this.SetState(State.OFF);
                            return (511 << ((9) - 9));
                        }
                        //Continue as sustain
                        this.rateIndex = 0;
                        this.SetState(State.SUSTAIN);
                    }
                    break;
                case State.SUSTAIN:
                    if ((this.reg20 & Operator20Masks.MASK_SUSTAIN) != 0) {
                        return vol;
                    }
                //In sustain phase, but not sustaining, do regular release
                case State.RELEASE:
                    vol += this.RateForward(this.releaseAdd);
                    if ((vol >= (511 << ((9) - 9)))) {
                        this.volume = (511 << ((9) - 9));
                        this.SetState(State.OFF);
                        return (511 << ((9) - 9));
                    }
                    break;
            }
            this.volume = vol;
            return vol | 0;
        }
        RateForward(add /* UInt32 */) {
            this.rateIndex += add | 0;
            let ret = this.rateIndex >>> 24;
            this.rateIndex = this.rateIndex & ((1 << 24) - 1);
            return ret;
        }
        ForwardWave() {
            this.waveIndex = (this.waveIndex + this.waveCurrent) >>> 0;
            return (this.waveIndex >>> (32 - 10));
        }
        ForwardVolume() {
            return this.currentLevel + this.TemplateVolume();
        }
        GetSample(modulation /** Int32 */) {
            //this.printDebug();
            let vol = this.ForwardVolume();
            if (((vol) >= ((12 * 256) >> (3 - ((9) - 9))))) {
                //Simply forward the wave
                this.waveIndex = (this.waveIndex + this.waveCurrent) >>> 0;
                return 0;
            }
            else {
                let index = this.ForwardWave();
                index += modulation;
                return this.GetWave(index, vol);
            }
        }
        GetWave(index /** Uint32 */, vol /** Uint32 */) {
            return ((DBOPL.GlobalMembers.WaveTable[this.waveBase + (index & this.waveMask)] * DBOPL.GlobalMembers.MulTable[vol >>> ((9) - 9)]) >> 16);
        }
    }
    DBOPL.Operator = Operator;
})(DBOPL || (DBOPL = {}));
/*
 *  Copyright (C) 2002-2015  The DOSBox Team
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
 */
/*
* 2019 - Typescript Version: Thomas Zeugner
*/
/*
    DOSBox implementation of a combined Yamaha YMF262 and Yamaha YM3812 emulator.
    Enabling the opl3 bit will switch the emulator to stereo opl3 output instead of regular mono opl2
    Except for the table generation it's all integer math
    Can choose different types of generators, using muls and bigger tables, try different ones for slower platforms
    The generation was based on the MAME implementation but tried to have it use less memory and be faster in general
    MAME uses much bigger envelope tables and this will be the biggest cause of it sounding different at times

    //TODO Don't delay first operator 1 sample in opl3 mode
    //TODO Maybe not use class method pointers but a regular function pointers with operator as first parameter
    //TODO Fix panning for the Percussion channels, would any opl3 player use it and actually really change it though?
    //TODO Check if having the same accuracy in all frequency multipliers sounds better or not

    //DUNNO Keyon in 4op, switch to 2op without keyoff.
*/
/* $Id: dbopl.cpp,v 1.10 2009-06-10 19:54:51 harekiet Exp $ */
var DBOPL;
(function (DBOPL) {
    var SynthMode;
    (function (SynthMode) {
        SynthMode[SynthMode["sm2AM"] = 0] = "sm2AM";
        SynthMode[SynthMode["sm2FM"] = 1] = "sm2FM";
        SynthMode[SynthMode["sm3AM"] = 2] = "sm3AM";
        SynthMode[SynthMode["sm3FM"] = 3] = "sm3FM";
        SynthMode[SynthMode["sm4Start"] = 4] = "sm4Start";
        SynthMode[SynthMode["sm3FMFM"] = 5] = "sm3FMFM";
        SynthMode[SynthMode["sm3AMFM"] = 6] = "sm3AMFM";
        SynthMode[SynthMode["sm3FMAM"] = 7] = "sm3FMAM";
        SynthMode[SynthMode["sm3AMAM"] = 8] = "sm3AMAM";
        SynthMode[SynthMode["sm6Start"] = 9] = "sm6Start";
        SynthMode[SynthMode["sm2Percussion"] = 10] = "sm2Percussion";
        SynthMode[SynthMode["sm3Percussion"] = 11] = "sm3Percussion";
    })(SynthMode = DBOPL.SynthMode || (DBOPL.SynthMode = {}));
    // Shifts for the values contained in chandata variable
    var Shifts;
    (function (Shifts) {
        Shifts[Shifts["SHIFT_KSLBASE"] = 16] = "SHIFT_KSLBASE";
        Shifts[Shifts["SHIFT_KEYCODE"] = 24] = "SHIFT_KEYCODE";
    })(Shifts = DBOPL.Shifts || (DBOPL.Shifts = {}));
    ;
    // Max buffer size.  Since only 512 samples can be generated at a time, setting
    // this to 512 * 2 channels means it'll be the largest it'll ever need to be.
    const BUFFER_SIZE_SAMPLES = 1024;
    class OPL {
        constructor(freq, channels) {
            this.dbopl = new DBOPL.Handler();
            this.buffer = new Int16Array(BUFFER_SIZE_SAMPLES * channels);
            this.mixer = new DBOPL.MixerChannel(this.buffer, channels);
            this.dbopl.Init(freq);
        }
        write(reg, val) {
            this.dbopl.WriteReg(reg, val);
        }
        generate(lenSamples) {
            if (lenSamples > 512) {
                throw new Error('OPL.generate() cannot generate more than 512 samples per call');
            }
            if (lenSamples < 2) {
                throw new Error('OPL.generate() cannot generate fewer than 2 samples per call');
            }
            this.dbopl.Generate(this.mixer, lenSamples);
            return this.buffer;
        }
    }
    DBOPL.OPL = OPL;
})(DBOPL || (DBOPL = {}));
/// example code used from : 
//////  https://github.com/Malvineous/opljs
var example;
(function (example) {
    let audioCtx = new AudioContext();
    let source = audioCtx.createBufferSource();
    let scriptNode = audioCtx.createScriptProcessor(8192, 2, 2);
    // When the buffer source stops playing, disconnect everything
    source.onended = () => {
        console.log('source.onended()');
        source.disconnect(scriptNode);
        scriptNode.disconnect(audioCtx.destination);
        scriptNode = null;
        source = null;
    };
    console.log('Sample rate', audioCtx.sampleRate);
    let mute = [], muteperc = 0;
    const imfdata = atob(`
AAAAAAAACwC4AAAAsQAAALMAAAC0AAAAtQAAALYAAAAyAgAAUiIAAHLyAACSEwAA8gAAADUCAABV
AQAAdfUAAJVDAAD1AAAAyA4AAKggAAC4LgAAIQIAAEEiAABh8gAAgRMAAOEAAAAkAgAARAEAAGT1
AACEQwAA5AAAAMEOAAChIAAAsSoAACgRAABIigAAaPEAAIgRAADoAAAAKwEAAEtBAABr8QAAi7MA
AOsAAADDAQAAoyAAALMuAAApEQAASYoAAGnxAACJEQAA6QAAACwBAABMQQAAbPEAAIyzAADsAAAA
xAEAAKQgAAC0KgAAKgUAAEpOAABq2gAAiiUAAOoAAAAtAQAATQEAAG35AACNFQAA7QAAAMUKAACl
MAAAtTcAADAyAABQRAAAcPgAAJD/AADwAAAAMxEAAFMBAABz9QAAk38AAPMAAADGDgAApjAAALYz
cACyAAAAthMAACIFAABCTgAAYtoAAIIlAADiAAAAJQEAAEUBAABl+QAAhRUAAOUAAADCCgAAojAA
ALIzAACmmAAAtjFwALUXAAC2EQAApSAAALU2AAC2MXAAshMAALYRAACiYwAAsjYAAKYwAAC2M3AA
tRYAAKWYAAC1NXAAshYAALYTAACiIAAAsjYAAKaYAAC2MXAAtRUAALU1cACyFgAAthEAAKIwAACy
NwAApjAAALYzcAC1FQAAtTVwALIXAAC2EwAAoiAAALI2AACmmAAAtjFwALUVAAC1NXAAshYAALYR
AACiYwAAsjYAALYxcAC1FQAAthEAALU1AACmMAAAtjNwALIWAACiIAAAsjZwALUVAAC2EwAAtTUA
AKaYAAC2MeAAuA4AALEKAACyFgAAsw4AALQKAAC2EQAAqGMAALguAAChYwAAsSoAAKLWAACyNgAA
o2MAALMuAACkYwAAtCoAAKbWAAC2MnAAtRUAALYSAAC1NQAApmsAALYxcACyFgAAthEAAKIgAACy
NgAAtjFwALUVAAC2EQAApWMAALU2AACm1gAAtjJwALIWAACimAAAsjVwALUWAAC2EgAApSAAALU2
AACmawAAtjFwALIVAACyNXAAtRYAALYRAACl1gAAtTYAAKbWAAC2MnAAshUAALI1cAC1FgAAthIA
AKUgAAC1NgAApmsAALYxcACyFQAAsjVwALUWAAC2EQAApWMAALU2AAC2MXAAshUAALYRAACyNQAA
ptYAALYycAC1FgAApSAAALU2cACyFQAAthIAALI1AACmawAAtjHUAA==`);
    const imf = new Uint8Array(imfdata.length);
    for (let i = 0; i < imfdata.length; i++) {
        imf[i] = imfdata.charCodeAt(i);
    }
    const samplesPerTick = Math.round(audioCtx.sampleRate / 560);
    console.log('Init WASM');
    let opl = new DBOPL.OPL(audioCtx.sampleRate, 2);
    console.log('WASM init done');
    let p = 0;
    let lenGen = 0;
    scriptNode.onaudioprocess = audioProcessingEvent => {
        var b = audioProcessingEvent.outputBuffer;
        var c0 = b.getChannelData(0);
        var c1 = b.getChannelData(1);
        let lenFill = b.length;
        let posFill = 0;
        while (posFill < lenFill) {
            // Fill any leftover delay from the last buffer-fill event first
            while (lenGen > 0) {
                if (lenFill - posFill < 2) {
                    // No more space in buffer
                    return;
                }
                let lenNow = Math.max(2, Math.min(512, lenGen, lenFill - posFill));
                const samples = opl.generate(lenNow);
                //const samples = new Int16Array(s);
                for (let i = 0; i < lenNow; i++) {
                    c0[posFill] = samples[i * 2 + 0] / 32768.0;
                    c1[posFill] = samples[i * 2 + 1] / 32768.0;
                    posFill++;
                }
                lenGen -= lenNow;
            }
            let delay;
            do {
                // Read the song event
                const reg = imf[p + 0];
                let val = imf[p + 1];
                delay = imf[p + 2] | (imf[p + 3] << 8);
                // Force the 'note-on' bit off, if the channel is muted
                if ((reg & 0xF0) == 0xB0) {
                    if (reg == 0xBD) {
                        val &= ~muteperc;
                    }
                    else if (mute[reg & 0x0F]) {
                        val &= ~0x20;
                    }
                } // else console.log(reg.toString(16), (reg & 0xF0).toString(16), (reg & 0xF0);
                opl.write(reg, val);
                // Advance to the next event in the song
                p += 4;
                if (p >= imf.length) {
                    console.log('Looping');
                    p = 0; // loop
                }
            } while (!delay);
            document.getElementById('progress').firstChild.nodeValue = Math.round(p / imf.length * 100) + '%';
            lenGen += delay * samplesPerTick;
        }
    };
    scriptNode.connect(audioCtx.destination);
    source.connect(scriptNode);
    source.start();
    audioCtx.suspend();
    console.log('Ready');
    const playBtn = document.getElementById('play');
    if (playBtn) {
        playBtn.onclick = () => {
            audioCtx.resume();
            console.log('Play');
        };
    }
    const pauseBtn = document.getElementById('pause');
    if (pauseBtn) {
        pauseBtn.onclick = () => {
            audioCtx.suspend();
            console.log('Pause');
        };
    }
    for (let i = 0; i < 9; i++) {
        mute[i] = false;
        const ct = document.getElementById('ch' + i);
        if (ct) {
            ct.className = 'play';
            ct.onclick = ev => {
                mute[i] = !mute[i];
                ev.target.className = mute[i] ? 'mute' : 'play';
            };
        }
    }
    for (let i = 0; i < 5; i++) {
        const ct = document.getElementById('p' + i);
        if (ct) {
            ct.className = 'play';
            ct.onclick = ev => {
                muteperc ^= 1 << i;
                const muted = !!(muteperc & (1 << i));
                ev.target.className = muted ? 'mute' : 'play';
            };
        }
    }
})(example || (example = {}));
//# sourceMappingURL=alib.js.map