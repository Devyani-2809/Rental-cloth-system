import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export default async function Page() {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)

    const { data: clothes } = await supabase.from('clothes').select()

    return (
        <ul>
            {clothes?.map((item) => (
                <li key={item.id}>{item.name}</li>
            ))}
        </ul>
    )
}
