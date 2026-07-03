// src/utils/validators.js
import Joi from 'joi';

export const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
});

export const createBatchSchema = Joi.object({
    batchNo: Joi.string().required(),
    productId: Joi.string().uuid().required(),
    batchSizeText: Joi.string().required(),
    batchSizeValue: Joi.number().optional(),
    remarks: Joi.string().optional(),
});

export const moveBatchSchema = Joi.object({
    stageId: Joi.string().uuid().required(),
    machineId: Joi.string().uuid().required(),
    remarks: Joi.string().optional(),
});

export const machineStatusSchema = Joi.object({
    status: Joi.string().valid('IDLE', 'RUNNING', 'CLEANING', 'DOWN').required(),
    note: Joi.string().optional(),
});