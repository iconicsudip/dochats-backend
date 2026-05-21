import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || '';

const isS3Configured = !!(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY && AWS_S3_BUCKET);

let s3Client: S3Client | null = null;
if (isS3Configured) {
    s3Client = new S3Client({
        region: AWS_REGION,
        credentials: {
            accessKeyId: AWS_ACCESS_KEY_ID!,
            secretAccessKey: AWS_SECRET_ACCESS_KEY!
        }
    });
    console.log('[S3] AWS S3 upload configured successfully.');
} else {
    console.log('[S3] AWS S3 is not configured. Falling back to local file storage.');
}

const LOCAL_UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

export interface UploadResult {
    key: string;
    filename: string;
    mimeType: string;
    size: number;
    url: string;
}

/**
 * Uploads a file (provided as base64) to S3 if configured, or stores it locally.
 */
export const uploadFile = async (
    base64Data: string,
    originalName: string,
    mimeType: string,
    responseId: string,
    fieldLabel: string,
    fileIndex: number
): Promise<UploadResult> => {
    // Standardize key/filename
    const cleanLabel = fieldLabel.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^\w]/g, '');
    const extension = originalName.split('.').pop() || 'jpg';
    const key = `forms/responses/${responseId}/${cleanLabel}_${fileIndex}.${extension}`;

    // Extract base64 buffer
    let base64Body = base64Data;
    if (base64Data.includes(';base64,')) {
        base64Body = base64Data.split(';base64,')[1];
    }
    const buffer = Buffer.from(base64Body, 'base64');
    const size = buffer.length;

    if (isS3Configured && s3Client) {
        try {
            await s3Client.send(
                new PutObjectCommand({
                    Bucket: AWS_S3_BUCKET,
                    Key: key,
                    Body: buffer,
                    ContentType: mimeType,
                })
            );
            return {
                key,
                filename: originalName,
                mimeType,
                size,
                url: `/api/forms/responses/file?key=${encodeURIComponent(key)}`
            };
        } catch (error) {
            console.error('[S3] Error uploading to S3, trying local fallback:', error);
            // Fall through to local upload on S3 failure
        }
    }

    // Local Storage Fallback
    const localPath = path.join(LOCAL_UPLOAD_DIR, key);
    const localDir = path.dirname(localPath);
    
    if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
    }
    
    fs.writeFileSync(localPath, buffer);
    return {
        key,
        filename: originalName,
        mimeType,
        size,
        url: `/api/forms/responses/file?key=${encodeURIComponent(key)}`
    };
};

/**
 * Downloads a file from S3 or local filesystem and returns a readable stream.
 */
export const getFileStream = async (key: string): Promise<{ stream: Readable; mimeType: string }> => {
    // Prevent directory traversal attacks
    const safeKey = key.replace(/\.\./g, '');

    if (isS3Configured && s3Client) {
        try {
            const response = await s3Client.send(
                new GetObjectCommand({
                    Bucket: AWS_S3_BUCKET,
                    Key: safeKey
                })
            );
            return {
                stream: response.Body as Readable,
                mimeType: response.ContentType || 'application/octet-stream'
            };
        } catch (error) {
            console.error('[S3] Error fetching from S3, trying local fallback:', error);
            // Fall through to local if S3 fails or file is not found on S3
        }
    }

    // Local Storage Fallback
    const localPath = path.join(LOCAL_UPLOAD_DIR, safeKey);
    if (!fs.existsSync(localPath)) {
        throw new Error('File not found');
    }

    // Attempt to guess mime type based on file extension
    const ext = path.extname(localPath).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.pdf') mimeType = 'application/pdf';

    return {
        stream: fs.createReadStream(localPath),
        mimeType
    };
};
