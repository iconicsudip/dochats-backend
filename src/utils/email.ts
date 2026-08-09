import { 
    SESClient, 
    SendEmailCommand, 
    CreateTemplateCommand, 
    UpdateTemplateCommand, 
    DeleteTemplateCommand,
    GetTemplateCommand,
    VerifyEmailIdentityCommand
} from "@aws-sdk/client-ses";
import { APP_NAME_LOWER } from "./brand";

const ses = new SESClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ""
    }
});

export const upsertSesTemplate = async (templateName: string, subject: string, html: string) => {
    const template = {
        TemplateName: templateName,
        SubjectPart: subject,
        HtmlPart: html,
        TextPart: "Please view this email in an HTML-compatible client."
    };

    try {
        // Check if template exists
        try {
            await ses.send(new GetTemplateCommand({ TemplateName: templateName }));
            // If it exists, update it
            await ses.send(new UpdateTemplateCommand({ Template: template }));
            console.log(`[SES] Template updated: ${templateName}`);
        } catch (error: any) {
            if (error.name === 'TemplateDoesNotExistException' || error.$metadata?.httpStatusCode === 404) {
                // If it doesn't exist, create it
                await ses.send(new CreateTemplateCommand({ Template: template }));
                console.log(`[SES] Template created: ${templateName}`);
            } else {
                throw error;
            }
        }
        return true;
    } catch (error) {
        console.error("[SES] Error upserting template:", error);
        throw error;
    }
};

export const deleteSesTemplate = async (templateName: string) => {
    try {
        await ses.send(new DeleteTemplateCommand({ TemplateName: templateName }));
        console.log(`[SES] Template deleted: ${templateName}`);
        return true;
    } catch (error: any) {
        if (error.name === 'TemplateDoesNotExistException') return true;
        console.error("[SES] Error deleting template:", error);
        throw error;
    }
};

export const verifySesIdentity = async (email: string) => {
    try {
        await ses.send(new VerifyEmailIdentityCommand({ EmailAddress: email }));
        console.log(`[SES] Verification email sent to: ${email}`);
        return true;
    } catch (error) {
        console.error("[SES] Error requesting identity verification:", error);
        throw error;
    }
};

export const sendEmail = async (to: string, subject: string, html: string, customFrom?: { email: string, name?: string }) => {
    const systemFrom = process.env.AWS_FROM_EMAIL || `noreply@${APP_NAME_LOWER}.com`;
    const fromAddress = customFrom?.email || systemFrom;
    const fromSource = customFrom?.name ? `"${customFrom.name}" <${fromAddress}>` : fromAddress;
    
    const params = {
        Destination: {
            ToAddresses: [to],
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: html,
                },
            },
            Subject: {
                Charset: "UTF-8",
                Data: subject,
            },
        },
        Source: fromSource,
    };

    try {
        const command = new SendEmailCommand(params);
        const data = await ses.send(command);
        console.log("[SES] Email sent:", data.MessageId);
        return data;
    } catch (error) {
        console.error("[SES] Error sending email:", error);
        throw error;
    }
};
