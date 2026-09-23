<script setup lang="ts">
import Flex from "../core/Flex.vue"
import Icon from "../core/Icon.vue"
import Text from "../core/Text.vue"
</script>

<template>
	<Flex align="center" gap="6">
		<Icon name="warning" size="12" color="red" />
		<Text size="12" weight="600" color="primary"><slot /></Text>
	</Flex>
</template>
