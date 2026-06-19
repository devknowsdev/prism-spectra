import type { Capability } from './Capability.js';
import type { CapabilityRequest } from './CapabilityRequest.js';

function scaffold(id:string,name:string): Capability {
 return {id,name,version:'0.1.0',canHandle:(r:CapabilityRequest)=>r.capability===id,async execute(){return {success:false,output:null,error:'Not implemented'};}};
}
export const vibeCodingCapability=scaffold('vibe-coding','Vibe Coding');
export const fileManagementCapability=scaffold('file-management','File Management');
export const audioProcessingCapability=scaffold('audio-processing','Audio Processing');
