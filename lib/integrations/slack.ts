import { WebClient } from "@slack/web-api";

export function getSlackClient(botToken?: string) {
  return new WebClient(botToken ?? process.env.SLACK_BOT_TOKEN!);
}

export async function sendSlackDM(userId: string, message: string): Promise<void> {
  const client = getSlackClient();

  // Open DM channel
  const dm = await client.conversations.open({ users: userId });
  const channelId = (dm.channel as any)?.id;
  if (!channelId) throw new Error("Could not open DM channel");

  await client.chat.postMessage({
    channel: channelId,
    text: message,
    mrkdwn: true,
  });
}

export async function getSlackUserInfo(userId: string) {
  const client = getSlackClient();
  const { user } = await client.users.info({ user: userId });
  return user;
}
