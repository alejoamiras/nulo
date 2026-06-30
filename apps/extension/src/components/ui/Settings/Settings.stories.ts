/**
 * Storybook coverage for the Settings family — ItemsContainer, SettingItem,
 * SettingField, SettingValue. The components compose into the canonical
 * "settings list" pattern used across the extension.
 */
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import ItemsContainer from "./ItemsContainer.vue"
import SettingItem from "./SettingItem.vue"
import SettingField from "./SettingField.vue"
import SettingValue from "./SettingValue.vue"

const meta: Meta<typeof ItemsContainer> = {
	title: "UI / Settings",
	component: ItemsContainer,
	tags: ["autodocs"],
	args: {
		title: "Profile",
		description: "Settings that apply to your active profile.",
	},
	render: (args) => ({
		components: { ItemsContainer, SettingItem },
		setup: () => ({ args }),
		template: `
			<div style="padding: 24px; width: 360px;">
				<ItemsContainer v-bind="args">
					<SettingItem title="Account" description="Manage your active account" icon="user" to="/popup/general" />
					<SettingItem title="Security" description="Password & seed phrase" icon="lock" to="/popup/general" />
					<SettingItem title="Disabled item" description="Temporarily disabled" icon="warning" :disabled="true" />
				</ItemsContainer>
			</div>
		`,
	}),
}
export default meta

type Story = StoryObj<typeof ItemsContainer>

export const Default: Story = {}
export const FlatVariant: Story = {
	args: { flat: true, title: "Flat container" },
	render: (args) => ({
		components: { ItemsContainer, SettingItem },
		setup: () => ({ args }),
		template: `
			<div style="padding: 24px; width: 360px;">
				<ItemsContainer v-bind="args">
					<SettingItem title="Item one" :raw="true" />
					<SettingItem title="Item two" :raw="true" />
				</ItemsContainer>
			</div>
		`,
	}),
}

export const SettingFieldStory: Story = {
	render: () => ({
		components: { ItemsContainer, SettingField },
		template: `
			<div style="padding: 24px; width: 360px;">
				<ItemsContainer title="Connection">
					<SettingField label="Network" value="Aztec testnet" icon="chevron" />
					<SettingField label="Endpoint" value="https://endpoint.example/" icon="chevron" />
					<SettingField label="Disabled field" value="Read only" :disabled="true" />
				</ItemsContainer>
			</div>
		`,
	}),
}

export const SettingValueStory: Story = {
	render: () => ({
		components: { ItemsContainer, SettingValue },
		template: `
			<div style="padding: 24px; width: 360px;">
				<ItemsContainer title="Profile">
					<SettingValue label="Name" value="Alice" icon="copy" />
					<SettingValue label="Address" value="0xab12…cd34" icon="copy" />
					<SettingValue label="Custom slot" value="(unused)">
						<template #value>
							<span style="font-family: monospace;">slot &lt;value&gt; override</span>
						</template>
					</SettingValue>
				</ItemsContainer>
			</div>
		`,
	}),
}

export const SettingItemSizes: Story = {
	render: () => ({
		components: { ItemsContainer, SettingItem },
		template: `
			<div style="padding: 24px; width: 360px;">
				<ItemsContainer>
					<SettingItem size="large" title="Large" description="Roomy padding" icon="user" chevron />
					<SettingItem size="medium" title="Medium" description="Default density" icon="user" chevron />
					<SettingItem size="small" title="Small" description="Compact" icon="user" chevron />
				</ItemsContainer>
			</div>
		`,
	}),
}
