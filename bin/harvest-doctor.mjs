#!/usr/bin/env node
import { createTools } from '../lib/core/tools.js'
console.log(JSON.stringify(await createTools().find(t => t.name === 'harvest_doctor').execute({}), null, 2))
